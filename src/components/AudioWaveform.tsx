import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface AudioWaveformProps {
  isActive: boolean;
  data: number[];
}

const AudioWaveform: React.FC<AudioWaveformProps> = ({ isActive, data }) => {
  const animatedValues = useRef<Animated.Value[]>([]);

  useEffect(() => {
    // Ensure we have the correct number of animated values
    while (animatedValues.current.length < data.length) {
      animatedValues.current.push(new Animated.Value(0));
    }
    while (animatedValues.current.length > data.length) {
      animatedValues.current.pop();
    }

    // Animate to new values
    Animated.parallel(
      data.map((value, index) =>
        Animated.timing(animatedValues.current[index], {
          toValue: isActive ? Math.max(0, (value + 160) / 160) : 0,
          duration: 50,
          useNativeDriver: false,
        })
      )
    ).start();
  }, [isActive, data]);

  return (
    <View style={styles.container}>
      {animatedValues.current.map((animatedValue, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              height: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
  },
  bar: {
    width: 2,
    marginHorizontal: 1,
    backgroundColor: '#4CAF50',
    minHeight: 1,
  },
});

export default AudioWaveform;