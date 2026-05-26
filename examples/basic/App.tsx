import { StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { Agent, Runner, setTracingDisabled, tool, OpenAIProvider, setDefaultOpenAIClient, setOpenAIAPI } from 'react-native-agent';
import { OpenAI } from 'openai';
import z from 'zod';
import { SafeAreaView } from 'react-native-safe-area-context';


function App() {
  const [result, setResult] = useState("loading");

  const init = async () => {
    const openaiClient = new OpenAI({
      apiKey: 'YOUR_API_KEY',
      baseURL: 'https://api.openai.com/v1',
    });
    const modelProvider = new OpenAIProvider({
      openAIClient: openaiClient,
    });
    setDefaultOpenAIClient(openaiClient); // Pass the OpenAI client instance
    setOpenAIAPI('chat_completions');
    setTracingDisabled(true);

    // Tool definition
    const getWeather = tool({
      name: 'get_weather',
      description: 'Get the weather for a city.',
      parameters: z.object({
        city: z.string().describe('The city to get weather for'),
      }),
      async execute(input: { city: string }) {
        // NOTE: change the sunny with rainy | windy | thunderstom
        // to observe the result.
        return `The weather in ${input.city} is sunny.`;
      },
    });

    const agent = new Agent({
      name: 'Assistant',
      instructions: 'You only respond in haikus.',
      model: 'gpt-5.4-mini',
      tools: [getWeather],
    });

    const runner = new Runner({ modelProvider });
    const result = await runner.run(agent, "What's the weather in Tokyo?");

    if (result?.finalOutput) {
      setResult(result?.finalOutput);
    }
  }
  useEffect(() => {
    init();
  }, [])

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{
        backgroundColor: 'blue',
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <Text style={{ color: 'white', flex: 1 }}>{result}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
