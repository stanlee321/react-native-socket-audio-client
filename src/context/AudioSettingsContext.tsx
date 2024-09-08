import React, { createContext, useState, useContext } from 'react';

interface AudioSettingsContextType {
  inputGain: number;
  setInputGain: (value: number) => void;
  amplification: number;
  setAmplification: (value: number) => void;
}

const AudioSettingsContext = createContext<AudioSettingsContextType | undefined>(undefined);

export const AudioSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [inputGain, setInputGain] = useState(1);
  const [amplification, setAmplification] = useState(1);

  return (
    <AudioSettingsContext.Provider value={{ inputGain, setInputGain, amplification, setAmplification }}>
      {children}
    </AudioSettingsContext.Provider>
  );
};

export const useAudioSettings = () => {
  const context = useContext(AudioSettingsContext);
  if (context === undefined) {
    throw new Error('useAudioSettings must be used within an AudioSettingsProvider');
  }
  return context;
};

export const MAX_AMPLIFICATION = 20;
export const NOISE_THRESHOLD = -50; // Add this line
export const COMPRESSION_FACTOR = 0.5; // Add this line