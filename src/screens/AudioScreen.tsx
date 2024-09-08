import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import AudioRecorder from '../components/AudioRecorder';

export default function AudioScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Audio Recorder</Text>
      <AudioRecorder />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
});