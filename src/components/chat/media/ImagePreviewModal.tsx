/**
 * ImagePreviewModal — lightbox simples para preview de imagem.
 *
 * Props públicas (contrato mantido para EmbeddedChatWindow):
 * - imageUrl: string | null
 * - isOpen: boolean
 * - onClose: () => void
 *
 * Extraído de WhatsAppChat.tsx (C3).
 */
import { X } from "lucide-react";

interface ImagePreviewModalProps {
  imageUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ImagePreviewModal({ imageUrl, isOpen, onClose }: ImagePreviewModalProps) {
  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 text-white hover:text-gray-300"
        onClick={onClose}
        aria-label="Fechar preview"
      >
        <X className="w-8 h-8" />
      </button>
      <img
        src={imageUrl}
        alt="Preview"
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
