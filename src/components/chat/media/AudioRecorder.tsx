/**
 * AudioRecorder — captura áudio do microfone e entrega Blob para o composer.
 *
 * Props públicas:
 * - onRecorded: (blob: Blob) => void
 * - onCancel: () => void
 *
 * Extraído de WhatsAppChat.tsx (C3).
 */
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send, X } from "lucide-react";
import { toast } from "sonner";
import { convertAudioBlobToMp3 } from "@/lib/audioToMp3";

interface AudioRecorderProps {
  onRecorded: (audioBlob: Blob) => void;
  onCancel: () => void;
}

export function AudioRecorder({ onRecorded, onCancel }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Tentar usar formato compatível com WhatsApp
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/ogg;codecs=opus";
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ""; // Usar padrão do browser
          }
        }
      }

      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (cancelledRef.current) {
          chunksRef.current = [];
          return;
        }

        const audioBlob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        // Converter para MP3 para compatibilidade Safari / Evolution API
        try {
          const converted = await convertAudioBlobToMp3(audioBlob);
          onRecorded(converted);
        } catch {
          onRecorded(audioBlob);
        }
      };

      mediaRecorder.start(100); // Coletar dados a cada 100ms
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone");
      onCancel();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    cancelledRef.current = true;
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    chunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onCancel();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    startRecording();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-3 w-full bg-red-50 dark:bg-red-950/30 p-3 rounded-lg">
      <Button variant="ghost" size="icon" onClick={cancelRecording}>
        <X className="w-5 h-5 text-red-500" />
      </Button>

      <div className="flex-1 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-medium tabular-nums">{formatTime(recordingTime)}</span>
        <span className="text-sm text-muted-foreground">Gravando...</span>
      </div>

      <Button
        variant="default"
        size="icon"
        onClick={stopRecording}
        className="bg-green-500 hover:bg-green-600"
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  );
}
