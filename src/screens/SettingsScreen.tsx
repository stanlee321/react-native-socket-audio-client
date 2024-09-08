import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { useAudioSettings, MAX_AMPLIFICATION } from '../context/AudioSettingsContext';

export default function SettingsScreen() {
  const { inputGain, setInputGain, amplification, setAmplification } = useAudioSettings();

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
  slider: {
    width: 200,
    height: 40,
    marginBottom: 20,
  },
});