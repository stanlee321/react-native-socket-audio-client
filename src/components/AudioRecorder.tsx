import React, { useState, useEffect, useCallback } from "react";
import { View, Button, StyleSheet, Text } from "react-native";
import { Audio } from 'expo-av';
import { useAudioSettings } from '../context/AudioSettingsContext';
import AudioWaveform from './AudioWaveform';

const AudioRecorder: React.FC = () => {
  const { amplification } = useAudioSettings();
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioData, setAudioData] = useState<number[]>([]);

  useEffect(() => {
    (async () => {
      try {
        console.log("Requesting audio permissions...");
        const { status } = await Audio.requestPermissionsAsync();
        console.log("Audio permission status:", status);
        if (status !== 'granted') {
          throw new Error('Audio permission not granted');
        }
        
        console.log("Setting audio mode...");
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        console.log("Audio mode set successfully");
      } catch (error) {
        console.error("Failed to set up audio:", error);
        setErrorMessage("Failed to set up audio. Please check app permissions.");
      }
    })();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      console.log("Start recording function called");
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      newRecording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording) {
          setAudioData(prev => [...prev, status.metering || -160]);
        }
      });
      await newRecording.startAsync();
      setRecording(newRecording);
      setIsRecording(true);
      console.log("Recording started successfully");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setErrorMessage(`Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      if (!recording) {
        console.error("No active recording");
        return;
      }
      
      console.log("Stopping recording...");
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setIsRecording(false);
      setAudioUri(uri);
      console.log("Recording stopped. Audio URI:", uri);
    } catch (error) {
      console.error("Failed to stop recording:", error);
      setErrorMessage(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [recording]);

  const playSound = useCallback(async () => {
    try {
      if (audioUri) {
        console.log("Starting playback...");
        const { sound: newSound } = await Audio.Sound.createAsync({ uri: audioUri });
        setSound(newSound);
        await newSound.playAsync();
        setIsPlaying(true);
        console.log("Playback started");
      }
    } catch (error) {
      console.error("Failed to play sound:", error);
      setErrorMessage(`Failed to play sound: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [audioUri]);

  const stopSound = useCallback(async () => {
    try {
      if (sound) {
        console.log("Stopping playback...");
        await sound.stopAsync();
        setIsPlaying(false);
        console.log("Playback stopped");
      }
    } catch (error) {
      console.error("Failed to stop sound:", error);
      setErrorMessage(`Failed to stop sound: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [sound]);

  return (
    <View style={styles.container}>
      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
      <Button
        title={isRecording ? "Stop Recording" : "Start Recording"}
        onPress={isRecording ? stopRecording : startRecording}
      />
      <View style={styles.waveformContainer}>
        <AudioWaveform data={audioData} isActive={isRecording || isPlaying} />
      </View>
      {audioUri && (
        <Button
          title={isPlaying ? "Stop Playing" : "Play Recording"}
          onPress={isPlaying ? stopSound : playSound}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  waveformContainer: {
    height: 100,
    width: '100%',
    backgroundColor: '#f0f0f0',
    marginVertical: 10,
  },
  errorText: {
    color: 'red',
    marginBottom: 10,
  },
});

export default AudioRecorder;