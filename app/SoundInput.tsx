"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

const HOST = 'http://localhost:8000'

function Table({ data }) {
  return (
    // <div className="flex justify-center items-center min-h-screen bg-gray-100">
      <div className="bg-white shadow-md rounded-lg overflow-hidden w-full max-w-4xl">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Дата
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Текст
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((item, index) => (
              <tr key={index}>
                <td className="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-900">
                  {item.created_at}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-500">
                  {item.content}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    // </div>
  );
}


export default function VoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [texts, setTexts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [message, setMessage] = useState("");
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket("ws://127.0.0.1:8000/ws");

    ws.onopen = () => {
      console.log("WebSocket подключен");
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      console.log("Получено сообщение:", event.data);
      setMessage(event.data);
    };

    ws.onclose = () => {
      console.log("WebSocket отключен");
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error("WebSocket ошибка:", error);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (userId) {
      fetch(`${HOST}/api/users/${userId}`)
        .then((res) => res.json())
        .then(data => setTexts(data.texts))
        .catch(console.error);
    }
  }, [userId]);

  const saveMessage = () => {
    if (wsRef.current) {
      wsRef.current.send(message);
    }
  };

  function sliceAudioBuffer(
    audioBuffer: AudioBuffer,
    startTime: number,
    endTime: number
  ) {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.floor(endTime * sampleRate);
    const frameCount = endSample - startSample;

    console.log(startSample, endSample, frameCount);

    const newBuffer = new AudioBuffer({
      length: frameCount,
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: sampleRate,
    });

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const oldData = audioBuffer.getChannelData(channel);
      const newData = newBuffer.getChannelData(channel);
      newData.set(oldData.subarray(startSample, endSample));
    }

    return newBuffer;
  }

  // Convert AudioBuffer to Linear16 PCM
  async function convertToLinear16(
    audioBuffer: AudioBuffer,
    targetSampleRate: number,
    targetChannels: number
  ) {
    // Create an offline audio context with the target sample rate
    const offlineCtx = new OfflineAudioContext(
      targetChannels,
      audioBuffer.duration * targetSampleRate,
      targetSampleRate
    );

    // Create a buffer source
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();

    // Render the audio
    const renderedBuffer = await offlineCtx.startRendering();

    // Convert Float32Array to Int16Array (Linear16 PCM)
    const numChannels = renderedBuffer.numberOfChannels;
    const length = renderedBuffer.length;
    const result = new Int16Array(length * targetChannels);

    // Process each channel
    for (let i = 0; i < numChannels; i++) {
      const channelData = renderedBuffer.getChannelData(i);

      // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
      // and interleave channels if stereo
      for (let j = 0; j < length; j++) {
        // Clipping prevention
        let sample = Math.max(-1, Math.min(1, channelData[j]));

        // Convert to 16-bit PCM
        sample = Math.floor(sample * 32767);

        // Set in the correct position based on channel interleaving
        result[j * targetChannels + i] = sample;
      }
    }

    return result.buffer;
  }

  const startRecording = async () => {
    setMessage("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const audioChunks: Blob[] = [];

      recorder.ondataavailable = async (event) => {
        audioChunks.push(event.data);

        try {
          const arrayBuffer = await new Blob(audioChunks, {
            type: "audio/webm",
          }).arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          const lastSample = sliceAudioBuffer(
            audioBuffer,
            audioContext.currentTime - 0.2,
            audioContext.currentTime
          );
          const linear16Data = await convertToLinear16(lastSample, 8000, 1);

          wsRef.current?.send(linear16Data);

          // setTimeout(() => wsRef.current?.send("end"), 10);
        } catch (error: unknown) {
          console.log(error);
        }
      };

      recorder.onstop = () => {
        setTimeout(() => wsRef.current?.send("end"), 100);
      };

      recorder.start(200);
      mediaRecorder.current = recorder;
      setIsRecording(true);
    } catch (error) {
      console.error("Ошибка доступа к микрофону:", error);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const name = formData.get("name");

    try {
      const response = await fetch(`${HOST}/api/users/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: name }),
      });

      const user = await response.json();

      if (user) {
        setUserId(user.user_id)
        setName(name as string);
      }
    } catch (error) {
      console.log(error)
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setIsRecording(false);
  };

  if (!name) {
    return (
      <div className="p-4 text-center">
        <h1 className="text-xl font-bold">Распознавание голоса в Next.js 🎤</h1>
        <form
          onSubmit={handleSubmit}
          className="max-w-md mx-auto mt-10 p-6 bg-white shadow-md rounded-lg"
        >
          <div className="mb-4">
            <label
              htmlFor="name"
              className="block text-gray-700 text-sm font-bold mb-2"
            >
              Введите ваше имя:
            </label>
            <input
              type="text"
              id="name"
              name="name"
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              placeholder="Ваше имя"
              required
            />
          </div>
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Отправить
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-4 text-center">
      <h1 className="text-xl font-bold">{`Добро пожаловать, ${name}! 🎤`}</h1>
      <button
        disabled={!isConnected}
        className={`my-4 px-6 py-2 text-white rounded disabled:bg-gray-400 disabled:cursor-not-allowed ${
          isRecording ? "bg-red-500" : "bg-green-500"
        }`}
        onClick={isRecording ? stopRecording : startRecording}
      >
        {isRecording ? "⏹ Остановить" : "🎙 Начать запись"}
      </button>

      <Table data={texts} />

      <div className="flex items-center gap-4 p-3 mt-3 shadow bg-white">
        <span className="text-gray-700 font-medium">Ваш запрос:</span>
        {message && (
          <>
            <span className="font-semibold">{message}</span>
            <div className="flex-row">
              {!isRecording && (
                <>
                  <div className="flex">
                    <button
                      onClick={saveMessage}
                      className="flex items-center gap-1 p-2 text-white rounded-lg"
                    >
                      ✅
                    </button>
                    <button
                      onClick={() => setMessage("")}
                      className="flex items-center gap-1 p-2 text-white rounded-lg"
                    >
                      ❌
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
