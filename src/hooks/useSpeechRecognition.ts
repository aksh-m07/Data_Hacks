import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecCtor = new () => SpeechRecognition;

function getSpeechRecognition(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Browser Web Speech API (Chrome/Android; limited on Safari). */
export function useSpeechRecognition() {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const recRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    setSupported(!!getSpeechRecognition());
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    stop();
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (ev: SpeechRecognitionEvent) => {
      // Split final vs interim so partial phrases don’t wipe earlier finalized sentences.
      let final = "";
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i]!;
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) {
          final += t;
        } else {
          interim += t;
        }
      }
      setText((final + interim).trim());
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recRef.current = r;
    r.start();
    setListening(true);
  }, [stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, text, toggle, stop, setText };
}
