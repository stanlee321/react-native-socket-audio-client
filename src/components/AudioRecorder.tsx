import React, { useState, useEffect } from "react";
import { View, Button, Text, StyleSheet } from "react-native";
import Slider from '@react-native-community/slider';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";

const AudioRecorder: React.FC = () => {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioData, setAudioData] = useState<string[]>([]);
  const [inputGain, setInputGain] = useState(1);
  const [amplification, setAmplification] = useState(1);
  const MAX_AMPLIFICATION = 20; // New constant for maximum amplification
  const [audioOutput, setAudioOutput] = useState<'speaker' | 'headphones'>('speaker');

  // Remove the useEffect hook that was causing the issue
  // useEffect(() => {
  //   toggleAudioOutput();
  //   // ...
  // }, [audioOutput]);

  async function startRecording() {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync({
        android: {
          extension: ".m4a",
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          numberOfChannels: 2,
          bitRate: 128000,
          sampleRate: 44100,
        },
        ios: {
          extension: ".m4a",
          audioQuality: Audio.IOSAudioQuality.MAX,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });
      newRecording.setOnRecordingStatusUpdate(updateAudioData);
      await newRecording.startAsync();

      setRecording(newRecording);
      setIsRecording(true);
      setAudioData([]);
    } catch (err) {
      console.error("Failed to start recording", err);
    }
  }

  async function stopRecording() {
    if (!recording) return;

    try {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      console.log("Recording stopped and stored at", uri);
      setRecording(null);

      if (uri) {
        // Normalize the amplification value to be between 0 and 1
        const normalizedVolume = Math.min(1, amplification / MAX_AMPLIFICATION);
        // Create a new sound object from the recorded audio
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri },
          { volume: normalizedVolume }
        );
        setSound(newSound);
        console.log("New sound object created with volume:", normalizedVolume);
      } else {
        console.error("No URI available for the recording");
      }
    } catch (error) {
      console.error("Error stopping recording:", error);
      setIsRecording(false);
      setRecording(null);
    }
  }

  const updateAudioData = (status: Audio.RecordingStatus) => {
    if (status.isRecording) {
      const { durationMillis, metering } = status;
      setAudioData((prevData) => [
        ...prevData,
        `${durationMillis},${metering}`,
      ]);
    }
  };

  async function playSound() {
    if (!sound) {
      console.error("No sound to play");
      return;
    }

    try {
      console.log("Playing Sound");
      setIsPlaying(true);
      
      // Normalize the amplification value to be between 0 and 1
      const normalizedVolume = Math.min(1, amplification / MAX_AMPLIFICATION);
      await sound.setVolumeAsync(normalizedVolume);
      
      // Reset the sound to the beginning before playing
      await sound.setPositionAsync(0);
      
      // Update audio routing before playing
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: audioOutput === 'headphones',
      });
      
      const playbackStatus = await sound.playAsync();
      console.log("Playback status:", playbackStatus);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded) {
          if (status.didJustFinish) {
            console.log("Playback finished");
            setIsPlaying(false);
            // Reset the sound position after it finishes playing
            sound.setPositionAsync(0);
          }
        } else {
          if (status.error) {
            console.error(`Playback error: ${status.error}`);
          }
        }
      });
    } catch (error) {
      console.error("Error playing sound:", error);
      setIsPlaying(false);
    }
  }

  async function stopSound() {
    if (!sound) {
      console.error("No sound to stop");
      return;
    }

    try {
      console.log("Stopping Sound");
      await sound.stopAsync();
      setIsPlaying(false);
    } catch (error) {
      console.error("Error stopping sound:", error);
      setIsPlaying(false);
    }
  }

  async function toggleAudioOutput() {
    try {
      const newOutput = audioOutput === 'speaker' ? 'headphones' : 'speaker';
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: newOutput === 'headphones',
      });

      setAudioOutput(newOutput);
      console.log(`Audio output switched to ${newOutput}`);

      // If there's an active sound, update its routing
      if (sound) {
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          const wasPlaying = status.isPlaying;
          if (wasPlaying) {
            await sound.stopAsync();
          }
          await sound.setIsLoopingAsync(false);
          await sound.unloadAsync();
          const { sound: newSound } = await Audio.Sound.createAsync(
            { uri: status.uri },
            { shouldPlay: wasPlaying, volume: status.volume }
          );
          setSound(newSound);
        }
      }
    } catch (error) {
      console.error("Error switching audio output:", error);
    }
  }

  return (
    <View style={styles.container}>
      <Text>Input Gain: {inputGain.toFixed(1)}</Text>
      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={5}
        step={0.1}
        value={inputGain}
        onValueChange={setInputGain}
      />
      <Text>Playback Amplification: {amplification.toFixed(1)}</Text>
      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={MAX_AMPLIFICATION}
        step={0.1}
        value={amplification}
        onValueChange={setAmplification}
      />
      <Button
        title={isRecording ? "Stop Recording" : "Start Recording"}
        onPress={isRecording ? stopRecording : startRecording}
      />
      <Text style={styles.statusText}>
        {isRecording ? "Recording..." : "Not recording"}
      </Text>
      <Text style={styles.dataText}>Audio data points: {audioData.length}</Text>
      {sound && (
        <Button
          title={isPlaying ? "Stop Playing" : "Play Recording"}
          onPress={isPlaying ? stopSound : playSound}
        />
      )}
      <Button
        title={`Switch to ${audioOutput === 'speaker' ? 'Headphones' : 'Speaker'}`}
        onPress={toggleAudioOutput}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  statusText: {
    marginTop: 10,
    fontSize: 16,
  },
  dataText: {
    marginTop: 10,
    fontSize: 14,
  },
  slider: {
    width: 200,
    height: 40,
  },
});

export default AudioRecorder;
