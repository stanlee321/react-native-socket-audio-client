import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface AudioWaveformProps {
  isActive: boolean;
  data: number[];
}

const MAX_BARS = 50; // Limit the number of bars in the waveform

const AudioWaveform: React.FC<AudioWaveformProps> = ({ isActive, data }) => {
  const animatedValues = useRef<Animated.Value[]>([]);

  const bars = useMemo(() => {
    const limitedData = data.slice(-MAX_BARS);
    while (animatedValues.current.length < limitedData.length) {
      animatedValues.current.push(new Animated.Value(0));
    }
    return limitedData.map((value, index) => ({
      value,
      animated: animatedValues.current[index],
    }));
  }, [data]);

  useEffect(() => {
    Animated.parallel(
      bars.map(bar =>
        Animated.timing(bar.animated, {
          toValue: isActive ? Math.max(0, (bar.value + 160) / 160) : 0,
          duration: 50,
          useNativeDriver: false,
        })
      )
    ).start();
  }, [isActive, bars]);

  return (
    <View style={styles.container}>
      {bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              height: bar.animated.interpolate({
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