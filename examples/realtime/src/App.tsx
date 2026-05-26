import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RealtimeAgent, RealtimeSession } from 'react-native-agent';
import { weatherBase64 } from './res/weather-base64';
import { usePCMStreamPlayer } from './useStreamingPCMPlayer';

export default function App() {
  const { pushChunk } = usePCMStreamPlayer();

  const start = async () => {
    const agent = new RealtimeAgent({
      name: 'Assistant',
      instructions: 'Greet the user with cheer and answer questions.',
    });
    const session = new RealtimeSession(agent, {
      model: 'gpt-realtime-2',
      config: {
        outputModalities: ['audio'],
        inputAudioFormat: 'pcm16',
        outputAudioFormat: 'pcm16',
        turnDetection: { type: 'server_vad' },
      },
    });

    session.on('audio', async (event: any) => {
      pushChunk(event.data);
    })

    await session.connect({ apiKey: 'YOUR_API_KEY' });

    session.sendAudio(weatherBase64, { commit: true, isBase64: true });
    session.transport.requestResponse?.();
  };

  return (
    <View style={styles.container}>
      <Pressable style={[styles.btn, styles.btnActive]} onPress={start}>
        <Text style={styles.txt}>{'🎤︎︎ Send the sample .wav \n "How is the weather"'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  btn: { paddingHorizontal: 40, paddingVertical: 18, borderRadius: 99, backgroundColor: '#2563eb' },
  btnActive: { backgroundColor: '#dc2626' },
  txt: { color: '#fff', fontSize: 18, fontWeight: '600' },
});