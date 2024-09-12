import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, Button, StyleSheet, Text, Switch, Platform } from "react-native";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { useAudioSettings } from '../context/AudioSettingsContext';
import AudioWaveform from './AudioWaveform';
import * as FileSystem from 'expo-file-system';

// Add this line at the top of the file
/// <reference path="../global.d.ts" />

const SAMPLE_RATE = 44100;
const NUM_CHANNELS = 1;
const SAMPLE_WIDTH = 2;
const RECONNECT_INTERVAL = 5000; // 5 seconds

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

const RECORDING_DURATION_MS = 1500; // 1 second

const configureAudioSession = async () => {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false
    });
    console.log("Audio session configured successfully");
  } catch (error) {
    console.error("Error configuring audio session:", error);
    throw error;
  }
};

const forceAudioToSpeaker = async (forPlayback = false) => {
  try {
    const audioMode = {
      allowsRecordingIOS:false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false,
    };

    if (Platform.OS === 'ios') {
      audioMode.playsInSilentModeIOS = true;
      // Force playback through speaker on iOS
      audioMode.interruptionModeIOS = InterruptionModeIOS.MixWithOthers;
    }

    await Audio.setAudioModeAsync(audioMode);
    console.log("Audio forced to speaker, playback mode:", forPlayback);
  } catch (error) {
    console.error("Error forcing audio to speaker:", error);
  }
};

const AudioRecorder: React.FC = () => {
  const { amplification } = useAudioSettings();
  const [isCallActive, setIsCallActive] = useState(false);
  const isCallActiveRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioData, setAudioData] = useState<number[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const webSocketRef = useRef<WebSocket | null>(null);
  const [lastSentTime, setLastSentTime] = useState<Date | null>(null);
  const [lastReceivedTime, setLastReceivedTime] = useState<Date | null>(null);
  const [detailedLogging, setDetailedLogging] = useState(false);
  const [wsReadyState, setWsReadyState] = useState<number>(WebSocket.CLOSED);
  const audioInputRef = useRef<Audio.Recording | null>(null);

  const recordingInterval = useRef<number | null>(null);

  const audioBufferRef = useRef<string[]>([]);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const [audioPlayer, setAudioPlayer] = useState<Audio.Sound | null>(null);

  const [isAudioRoutedToSpeaker, setIsAudioRoutedToSpeaker] = useState(true);

  const ensureAudioToSpeaker = useCallback(() => {
    forceAudioToSpeaker(true).catch(err => console.error("Error in ensureAudioToSpeaker:", err));
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!isCallActiveRef.current) {
      console.log("Call is not active, skipping WebSocket connection");
      return;
    }

    console.log("Connecting WebSocket...");
    
    const wsUrl = Platform.OS === 'web' 
      ? 'ws://localhost:8765'
      : 'ws://192.168.1.6:8765/ws'; // Replace with your development machine's IP address

    console.log(`Attempting to connect to WebSocket at ${wsUrl}`);
    const socket = new WebSocket(wsUrl);
    webSocketRef.current = socket;

    socket.onopen = () => {
      console.log('WebSocket Connected');
      setIsConnected(true);
      setWsReadyState(WebSocket.OPEN);
      // Attempt to send any buffered audio data
      while (audioBufferRef.current.length > 0) {
        const audioData = audioBufferRef.current.shift();
        if (audioData) {
          sendAudioData(audioData);
        }
      }
    };

    socket.onclose = (event) => {
      console.log('WebSocket Disconnected', event.code, event.reason);
      setIsConnected(false);
      setWsReadyState(WebSocket.CLOSED);
      if (isCallActiveRef.current) {
        console.log("Attempting to reconnect...");
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, RECONNECT_INTERVAL);
      } else {
        console.log("Call is not active, not attempting to reconnect");
      }
    };

    socket.onerror = (error: Event) => {
      console.error('WebSocket Error:', error);
      setErrorMessage('WebSocket connection error');
      setWsReadyState(WebSocket.CLOSED);
    };

    socket.onmessage = async (event) => {
      try {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.ai_response) {
            setLastReceivedTime(new Date());
            console.log('Received AUDIO:', message.transcription.full_transcript);
            const audioData = message.ai_response.ai_audio
            if (audioData) {
              try {
                await playBase64Audio(audioData);
              } catch (audioError) {
                console.error('Error playing AI audio:', audioError);
              }
            }
            
            // Handle other fields like transcription, full_transcript, is_silent, ai_response if needed
          } else {

            console.log('Received unknown message type:', message);
          }
        } else {
          console.log('Received unknown data type:', typeof event.data);
        }
      } catch (error) {
        console.error('Error processing received message:', error);
      }
    };
  }, []);

  const sendAudioData = useCallback(async (audioData: string | ArrayBuffer) => {
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      try {
        let audioString: string;
        if (audioData instanceof ArrayBuffer) {
          // Convert ArrayBuffer to base64 string
          audioString = arrayBufferToBase64(audioData);
        } else {
          audioString = audioData;
        }
        
        // Send audio data as a JSON object with base64 encoded audio
        const message = JSON.stringify({ audio: audioString });
        webSocketRef.current.send(message);
        setLastSentTime(new Date());

        if (detailedLogging) {
          console.log('Sent audio data, total length:', message.length);
        }
      } catch (error) {
        console.error('Error in sendAudioData:', error);
        setErrorMessage(`Failed to send audio data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      console.log('WebSocket not ready, buffering audio data');
      audioBufferRef.current.push(typeof audioData === 'string' ? audioData : arrayBufferToBase64(audioData));
    }
  }, [detailedLogging]);

  const stopAudioInput = useCallback(async () => {
    if (audioInputRef.current) {
      try {
        console.log("Stopping audio input...");
        await audioInputRef.current.stopAndUnloadAsync();
        audioInputRef.current = null;
        // Clear any pending timeouts
        if (recordingInterval.current) {
          clearTimeout(recordingInterval.current);
          recordingInterval.current = null;
        }
        console.log("Audio input stopped and unloaded");
      } catch (error) {
        console.error("Failed to stop audio input:", error);
        setErrorMessage(`Failed to stop audio input: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }, []);

  const startAudioInput = useCallback(async () => {
    try {
      console.log("Starting audio input...");

      // Request permissions
      const permissionResponse = await Audio.requestPermissionsAsync();
      console.log("Audio permission status:", permissionResponse.status);
      if (permissionResponse.status !== 'granted') {
        throw new Error('Audio recording permission not granted');
      }

      // Set audio mode for recording
      console.log("Setting audio mode for recording...");
      await configureAudioSession();
      console.log("Audio mode set for recording");

      const recordAndSend = async (retryCount = 0) => {
        console.log("recordAndSend called, isCallActiveRef:", isCallActiveRef.current);
        if (!isCallActiveRef.current) {
          console.log("Call is not active, stopping recording loop");
          return;
        }

        try {
          console.log("Starting new recording cycle");
          // await configureAudioSession();

          // Add a small delay after configuring the audio session
          await new Promise<void>(resolve => setTimeout(resolve, 100));

          const recording = new Audio.Recording();
          try {
            console.log("Preparing to record...");
            await recording.prepareToRecordAsync({
              android: {
                extension: '.m4a',
                outputFormat: Audio.AndroidOutputFormat.MPEG_4,
                audioEncoder: Audio.AndroidAudioEncoder.AAC,
                sampleRate: 44100,
                numberOfChannels: 2,
                bitRate: 128000,
              },
              ios: {
                extension: '.m4a',
                outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
                audioQuality: Audio.IOSAudioQuality.HIGH,
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

            console.log("Starting recording...");
            await recording.startAsync();
            console.log(`Recording for ${RECORDING_DURATION_MS / 1000} seconds...`);
            await new Promise<void>(resolve => setTimeout(resolve, RECORDING_DURATION_MS));
            console.log("Stopping recording...");
            await recording.stopAndUnloadAsync();
            console.log("Recording stopped");

            const uri = recording.getURI();
            if (!uri) {
              throw new Error("Failed to get recording URI");
            }

            console.log("Reading recorded file...");
            const fileContent = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

            console.log("Sending audio data...");
            await sendAudioData(fileContent);

            // Clean up the temporary file
            await FileSystem.deleteAsync(uri, { idempotent: true });

            // Reset retry count on successful recording
            retryCount = 0;
          } catch (error) {
            console.error("Error in recording cycle:", error);
            if (retryCount < MAX_RETRY_ATTEMPTS) {
              console.log(`Retrying recording (Attempt ${retryCount + 1} of ${MAX_RETRY_ATTEMPTS})...`);
              await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY));
              return recordAndSend(retryCount + 1);
            } else {
              console.error("Max retry attempts reached. Stopping recording loop.");
              setErrorMessage("Failed to record audio after multiple attempts. Please try again later.");
              return;
            }
          }

          if (isCallActiveRef.current) {
            console.log("Scheduling next recording...");
            setTimeout(() => recordAndSend(0), 0);
          } else {
            console.log("Call is no longer active, stopping recording loop");
          }
        } catch (error) {
          console.error("Unhandled error in recordAndSend:", error);
          setErrorMessage(`Unhandled error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      };

      // Start the recording loop
      console.log("Starting recording loop...");
      recordAndSend();

      console.log("Audio input started successfully");
    } catch (error) {
      console.error("Failed to start audio input:", error);
      setErrorMessage(`Failed to start audio input: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [sendAudioData]);

  const startCall = useCallback(async () => {
    console.log("Starting call...");
    try {
      await stopAudioInput();
      setIsCallActive(true);
      isCallActiveRef.current = true;
      console.log("isCallActive set to true, isCallActiveRef:", isCallActiveRef.current);
      // await forceAudioToSpeaker(false); // Set for recording
      connectWebSocket();
      await startAudioInput();
      console.log("Call started successfully");
    } catch (error) {
      console.error("Failed to start call:", error);
      setErrorMessage(`Failed to start call: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsCallActive(false);
      isCallActiveRef.current = false;
    }
  }, [connectWebSocket, startAudioInput, stopAudioInput]);

  const endCall = useCallback(async () => {
    console.log("Ending call...");
    try {
      setIsCallActive(false);
      isCallActiveRef.current = false;
      console.log("isCallActive set to false, isCallActiveRef:", isCallActiveRef.current);
      await stopAudioInput();
      if (webSocketRef.current) {
        webSocketRef.current.close();
        webSocketRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setIsConnected(false);
      setAudioData([]);
      audioBufferRef.current = [];
      setWsReadyState(WebSocket.CLOSED);
      console.log("Call ended successfully");
    } catch (error) {
      console.error("Failed to end call:", error);
      setErrorMessage(`Failed to end call: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [stopAudioInput]);

  const handleCallButton = useCallback(() => {
    console.log("Call button pressed. Current state:", isCallActive ? "Active" : "Inactive");
    if (isCallActive) {
      endCall();
    } else {
      startCall();
    }
  }, [isCallActive, startCall, endCall]);

  const playBase64Audio = async (base64Audio: string) => {
    try {
      const tempFile = `${FileSystem.cacheDirectory}temp_audio_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(tempFile, base64Audio, { encoding: FileSystem.EncodingType.Base64 });

      if (audioPlayer) {
        await audioPlayer.stopAsync();
        await audioPlayer.unloadAsync();
      }

      // // Force audio to speaker for playback
      // await forceAudioToSpeaker(true);

      const { sound } = await Audio.Sound.createAsync(
        { uri: tempFile },
        { shouldPlay: false, volume: 1.0, isLooping: false }
      );

      if (sound) {
        setAudioPlayer(sound);

        sound.setOnPlaybackStatusUpdate(async (status) => {
          if ('didJustFinish' in status && status.didJustFinish) {
            await FileSystem.deleteAsync(tempFile);
            await sound.unloadAsync();
            // Reset audio mode after playback
            // await forceAudioToSpeaker(false);
          } else if ('isPlaying' in status && status.isPlaying) {
            // Ensure audio is routed to speaker during playback
            // await forceAudioToSpeaker(true);
          }
        });

        // Double-check audio routing before playing
        // await forceAudioToSpeaker(true);
        await sound.playAsync();

        // Force audio to speaker again after a short delay
        // setTimeout(() => forceAudioToSpeaker(true), 100);
      } else {
        console.error('Failed to create sound object');
        await FileSystem.deleteAsync(tempFile);
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      try {
        await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}temp_audio_${Date.now()}.mp3`);
      } catch (cleanupError) {
        console.error('Error cleaning up temporary file:', cleanupError);
      }
    }
  };

  // useEffect(() => {
  //   const setupAudioSession = async () => {
  //     await forceAudioToSpeaker(false);
  //   };

  //   setupAudioSession();

  //   return () => {
  //     if (audioPlayer) {
  //       audioPlayer.unloadAsync();
  //     }
  //   };
  // }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text>WebSocket: {
          wsReadyState === WebSocket.CONNECTING ? 'Connecting' :
          wsReadyState === WebSocket.OPEN ? 'Connected' :
          wsReadyState === WebSocket.CLOSING ? 'Closing' :
          'Disconnected'
        }</Text>
      </View>
      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
      <Button
        title={isCallActive ? "End Call" : "Start Call"}
        onPress={handleCallButton}
        disabled={false}
      />
      <Text>Call Status: {isCallActive ? "Active" : "Inactive"}</Text>
      <Text>Last Sent: {lastSentTime ? lastSentTime.toLocaleTimeString() : 'N/A'}</Text>
      <Text>Last Received: {lastReceivedTime ? lastReceivedTime.toLocaleTimeString() : 'N/A'}</Text>
      <View style={styles.waveformContainer}>
        <AudioWaveform data={audioData} isActive={isCallActive} />
      </View>
      <View style={styles.debugContainer}>
        <Text>Detailed Logging:</Text>
        <Switch
          value={detailedLogging}
          onValueChange={setDetailedLogging}
        />
      </View>
      <Text>Audio Routed to Speaker: {isAudioRoutedToSpeaker ? 'Yes' : 'No'}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
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
  debugContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
});

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

declare function btoa(data: string): string;

export default AudioRecorder;