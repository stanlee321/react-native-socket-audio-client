import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, Button, StyleSheet, Text, Switch } from "react-native";
import { Audio } from 'expo-av';
import { useAudioSettings } from '../context/AudioSettingsContext';
import AudioWaveform from './AudioWaveform';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

// Add this line at the top of the file
/// <reference path="../global.d.ts" />

const SAMPLE_RATE = 44100;
const NUM_CHANNELS = 1;
const SAMPLE_WIDTH = 2;
const RECONNECT_INTERVAL = 5000; // 5 seconds

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

  const audioBufferRef = useRef<ArrayBuffer[]>([]);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const [audioPlayer, setAudioPlayer] = useState<Audio.Sound | null>(null);

  const connectWebSocket = useCallback(() => {
    if (!isCallActiveRef.current) {
      console.log("Call is not active, skipping WebSocket connection");
      return;
    }

    console.log("Connecting WebSocket...");
    
    const wsUrl = Platform.OS === 'web' 
      ? 'ws://localhost:8765'
      : 'ws://192.168.1.6:8765'; // Replace with your development machine's IP address

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
        if (event.data instanceof Blob) {
          // Handle binary data (audio)
          const arrayBuffer = await event.data.arrayBuffer();
          if (detailedLogging) {
            console.log('Received binary audio data, length:', arrayBuffer.byteLength);
          }
          setLastReceivedTime(new Date());
          // Process the received audio data here (e.g., play it or update the waveform)
          await playAudioData(arrayBuffer);
        } else if (typeof event.data === 'string') {
          // Handle text data
          if (event.data.startsWith('{') && event.data.endsWith('}')) {
            // Attempt to parse as JSON
            const message = JSON.parse(event.data);
            if (message.type === 'audio_output') {
              if (detailedLogging) {
                console.log('Received audio data:', message.data.substring(0, 50) + '...');
              }
              setLastReceivedTime(new Date());
              // Handle received audio data if needed
            } else {
              console.log('Received non-audio message:', message);
            }
          } else {
            // Handle non-JSON text data
            console.log('Received non-JSON text data:', event.data);
          }
        } else {
          console.log('Received unknown data type:', typeof event.data);
        }
      } catch (error) {
        console.error('Error processing received message:', error);
      }
    };
  }, [detailedLogging]);

  const sendAudioData = useCallback(async (audioData: ArrayBuffer) => {
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      try {
        // Send audio data as binary
        webSocketRef.current.send(audioData);
        setLastSentTime(new Date());

        if (detailedLogging) {
          console.log('Sent audio data, total length:', audioData.byteLength);
        }
      } catch (error) {
        console.error('Error in sendAudioData:', error);
        setErrorMessage(`Failed to send audio data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      console.log('WebSocket not ready, buffering audio data');
      audioBufferRef.current.push(audioData);
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

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      console.log("Audio mode set");

      const recordAndSend = async () => {
        console.log("recordAndSend called, isCallActiveRef:", isCallActiveRef.current);
        if (!isCallActiveRef.current) {
          console.log("Call is not active, stopping recording loop");
          return;
        }

        console.log("Starting new recording cycle");
        const recording = new Audio.Recording();
        try {
          console.log("Preparing to record...");
          await recording.prepareToRecordAsync({
            android: {
              extension: '.wav',
              outputFormat: Audio.AndroidOutputFormat.DEFAULT,
              audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
              sampleRate: SAMPLE_RATE,
              numberOfChannels: NUM_CHANNELS,
            },
            ios: {
              extension: '.wav',
              outputFormat: Audio.IOSOutputFormat.LINEARPCM,
              audioQuality: Audio.IOSAudioQuality.HIGH,
              sampleRate: SAMPLE_RATE,
              numberOfChannels: NUM_CHANNELS,
              bitRate: 16000,
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
          console.log("Recording for 1 second...");
          await new Promise<void>(resolve => setTimeout(resolve, 1000)); // Record for 1 second
          console.log("Stopping recording...");
          await recording.stopAndUnloadAsync();
          console.log("Recording stopped");

          const { sound, status } = await recording.createNewLoadedSoundAsync();
          if (status.isLoaded) {
            const audioStatus = await sound.getStatusAsync();
            if (audioStatus.isLoaded && audioStatus.uri) {
              console.log("Fetching audio data...");
              const response = await fetch(audioStatus.uri);
              const arrayBuffer = await response.arrayBuffer();
              console.log("Sending audio data...");
              await sendAudioData(arrayBuffer);
            }
            await sound.unloadAsync();
          }

          if (isCallActiveRef.current) {
            console.log("Scheduling next recording...");
            setTimeout(recordAndSend, 0);
          } else {
            console.log("Call is no longer active, stopping recording loop");
          }
        } catch (error) {
          console.error("Error in recording cycle:", error);
          setErrorMessage(`Error in recording cycle: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue the recording loop even if there's an error
          if (isCallActiveRef.current) {
            console.log("Scheduling next recording despite error...");
            setTimeout(recordAndSend, 1000);
          }
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

  const playAudioData = async (arrayBuffer: ArrayBuffer) => {
    try {
      // Convert ArrayBuffer to Base64
      const base64Audio = arrayBufferToBase64(arrayBuffer);
      
      // Write to a temporary file
      const tempFile = `${FileSystem.cacheDirectory}temp_audio_${Date.now()}.wav`;
      await FileSystem.writeAsStringAsync(tempFile, base64Audio, { encoding: FileSystem.EncodingType.Base64 });

      // Stop and unload previous audio if exists
      if (audioPlayer) {
        await audioPlayer.stopAsync();
        await audioPlayer.unloadAsync();
      }

      // Create a new Audio.Sound object and play it
      const { sound } = await Audio.Sound.createAsync(
        { uri: tempFile },
        { shouldPlay: true }
      );
      setAudioPlayer(sound);

      // Clean up the temporary file after playback
      sound.setOnPlaybackStatusUpdate(async (status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          await FileSystem.deleteAsync(tempFile);
        }
      });

    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };

  useEffect(() => {
    return () => {
      if (recordingInterval.current) {
        clearInterval(recordingInterval.current);
      }
      if (audioPlayer) {
        audioPlayer.unloadAsync();
      }
    };
  }, [audioPlayer]);

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