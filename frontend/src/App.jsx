import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import * as faceapi from "face-api.js";
import VRMAvatar from "./VRMAvatar";

const BACKEND = "http://localhost:5000";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [emotion, setEmotion] = useState("neutral");
  const [started, setStarted] = useState(false);
  const [caption, setCaption] = useState("");
  const [mouthOpen, setMouthOpen] = useState(0);
  const [headRotation, setHeadRotation] = useState({ x: 0, y: 0 });

  const videoRef = useRef(null);
  const recognitionRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const mouthIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const currentAudioRef = useRef(null);
  const animationFrameRef = useRef(null);

  // ---------------- Face Tracking via Webcam ----------------
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: false,
      });
      if (videoRef.current) videoRef.current.srcObject = stream;

      const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      detectFaceLoop();
    } catch (err) {
      console.warn("Camera denied:", err.message);
    }
  };

  const detectFaceLoop = async () => {
    const detect = async () => {
      if (videoRef.current && videoRef.current.readyState === 4) {
        try {
          const result = await faceapi.detectSingleFace(
            videoRef.current,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 160 })
          );
          if (result) {
            const { x, y, width, height } = result.box;
            const cx = x + width / 2;
            const cy = y + height / 2;
            const normX = (cx / 320 - 0.5) * 2; // -1 to 1
            const normY = (cy / 240 - 0.5) * 2;
            setHeadRotation({ x: -normX, y: -normY });
          }
        } catch (e) {}
      }
      setTimeout(detect, 150);
    };
    detect();
  };

  // ---------------- Speech Recognition ----------------
  const initRecognition = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Please use Chrome browser for voice.");
      return null;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "hi-IN"; // 🌟 Hindi support added

    rec.onstart = () => setStatus("listening");
    rec.onerror = (e) => {
      console.warn("Speech error:", e.error);
      if (!isSpeakingRef.current) setTimeout(() => safeStart(), 800);
    };
    rec.onend = () => {
      if (!isSpeakingRef.current && status !== "thinking") {
        setTimeout(() => safeStart(), 400);
      }
    };
    rec.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setCaption(`You: ${transcript}`);
      await handleUserSpeech(transcript);
    };

    return rec;
  };

  const safeStart = () => {
    try {
      if (recognitionRef.current && !isSpeakingRef.current) {
        recognitionRef.current.start();
      }
    } catch (e) {}
  };

  const handleUserSpeech = async (text) => {
    setStatus("thinking");
    try {
      const res = await axios.post(`${BACKEND}/chat`, { message: text });
      const { reply, emotion } = res.data;
      setEmotion(emotion || "neutral");
      setCaption(`Mikasa: ${reply}`);
      await speak(reply);
    } catch (err) {
      console.error(err);
      await speak("arre yaar... kuch toh gadbad hai. phir se bolo na?");
    }
  };

  // ---------------- 🎙️ Edge TTS with REAL lip-sync ----------------
  const speak = async (text) => {
    try {
      // Stop any previous audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      isSpeakingRef.current = true;
      setStatus("speaking");

      // Fetch audio from backend
      const res = await fetch(`${BACKEND}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: "hi-IN-SwaraNeural", // sweet female Hindi voice
        }),
      });

      if (!res.ok) throw new Error("TTS failed");

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      // 🎵 Setup Web Audio API for REAL lip-sync (analyzes volume)
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext ||
            window.webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        const source = audioCtx.createMediaElementSource(audio);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const animateMouth = () => {
          if (!isSpeakingRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          // Average volume — focus on speech freq (low-mid)
          let sum = 0;
          for (let i = 0; i < 32; i++) sum += dataArray[i];
          const avg = sum / 32 / 255; // 0-1
          setMouthOpen(Math.min(1, avg * 2.2)); // amplify
          animationFrameRef.current = requestAnimationFrame(animateMouth);
        };
        animateMouth();
      } catch (audioErr) {
        // Fallback: random mouth animation if Web Audio fails
        console.warn("Web Audio fallback:", audioErr.message);
        startMouth();
      }

      audio.onended = () => {
        isSpeakingRef.current = false;
        stopMouth();
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        setMouthOpen(0);
        setStatus("listening");
        URL.revokeObjectURL(audioUrl);
        setTimeout(() => safeStart(), 300);
      };

      audio.onerror = (err) => {
        console.error("Audio play error:", err);
        isSpeakingRef.current = false;
        stopMouth();
        setStatus("listening");
        setTimeout(() => safeStart(), 300);
      };

      await audio.play();
    } catch (err) {
      console.error("Speak error:", err);
      isSpeakingRef.current = false;
      stopMouth();
      setStatus("listening");
      // Fallback to browser TTS if backend fails
      fallbackBrowserTTS(text);
    }
  };

  // 🔄 Fallback if backend TTS fails
  const fallbackBrowserTTS = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1;
    utter.pitch = 1.35;
    utter.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /hindi|female|samantha|zira/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("hi") || v.lang.startsWith("en"));
    if (preferred) utter.voice = preferred;

    utter.onstart = () => {
      isSpeakingRef.current = true;
      setStatus("speaking");
      startMouth();
    };
    utter.onend = () => {
      isSpeakingRef.current = false;
      stopMouth();
      setStatus("listening");
      setTimeout(() => safeStart(), 300);
    };
    window.speechSynthesis.speak(utter);
  };

  const startMouth = () => {
    if (mouthIntervalRef.current) clearInterval(mouthIntervalRef.current);
    mouthIntervalRef.current = setInterval(() => {
      setMouthOpen(0.2 + Math.random() * 0.8);
    }, 90);
  };

  const stopMouth = () => {
    clearInterval(mouthIntervalRef.current);
    setMouthOpen(0);
  };

  const handleStart = async () => {
    setStarted(true);
    await startCamera();
    recognitionRef.current = initRecognition();
    window.speechSynthesis.getVoices();
    setTimeout(() => {
      speak("haaye... finally aa gaye tum. main wait kar rahi thi 🙈");
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      window.speechSynthesis.cancel();
      if (currentAudioRef.current) currentAudioRef.current.pause();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      clearInterval(mouthIntervalRef.current);
    };
  }, []);

  return (
    <div className={`app emotion-${emotion}`}>
      <div className="bg-gradient" />
      <div className="vignette" />

      {!started ? (
        <div className="start-screen">
          <h1 className="title">Mikasa</h1>
          <p className="subtitle">she's been waiting for you...</p>
          <button className="start-btn" onClick={handleStart}>
            Start Call 💖
          </button>
        </div>
      ) : (
        <>
          {/* 3D VRM Avatar */}
          <div className="avatar-container">
            <VRMAvatar
              mouthOpen={mouthOpen}
              emotion={emotion}
              headRotation={headRotation}
              isSpeaking={status === "speaking"}
            />
          </div>

          {/* Webcam preview */}
          <div className="webcam-wrap">
            <video ref={videoRef} autoPlay muted playsInline />
            <span className="webcam-label">You</span>
          </div>

          {/* Status */}
          <div className="status-bar">
            <span className={`dot dot-${status}`} />
            <span className="status-text">
              {status === "listening" && "listening..."}
              {status === "thinking" && "thinking..."}
              {status === "speaking" && "speaking..."}
              {status === "idle" && "connected"}
            </span>
          </div>

          {caption && <div className="caption">{caption}</div>}

          <div className="call-info">
            <span className="call-name">Mikasa 💖</span>
            <span className="call-timer">● Live</span>
          </div>
        </>
      )}
    </div>
  );
}