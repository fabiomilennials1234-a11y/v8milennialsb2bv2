import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the AudioRecorder cancel-vs-send logic.
 *
 * Since AudioRecorder is an inline component inside WhatsAppChat.tsx and
 * depends on browser MediaRecorder APIs, we test the core logic by
 * simulating the ref-based flag mechanism used in the fix.
 */

// Simulates the cancelledRef + onstop logic extracted from AudioRecorder
function createRecorderLogic() {
  let cancelledRef = false;
  let chunks: string[] = [];
  const onRecorded = vi.fn();
  const onCancel = vi.fn();
  let onstopCallback: (() => void) | null = null;

  function startRecording() {
    cancelledRef = false;
    chunks = [];
    // Simulate MediaRecorder setup
    onstopCallback = () => {
      if (cancelledRef) {
        chunks = [];
        return;
      }
      const audioBlob = { data: chunks.join(","), size: chunks.length };
      onRecorded(audioBlob);
    };
  }

  function addChunk(data: string) {
    chunks.push(data);
  }

  function stopRecording() {
    // Simulate mediaRecorder.stop() -> triggers onstop asynchronously
    // We call onstopCallback synchronously here to test the logic
    onstopCallback?.();
  }

  function cancelRecording() {
    cancelledRef = true;
    // stop triggers onstop which should check the flag
    onstopCallback?.();
    chunks = [];
    onCancel();
  }

  // Simulate onstop firing AFTER cancelRecording returns (async race condition)
  function simulateLateOnstop() {
    onstopCallback?.();
  }

  return {
    startRecording,
    addChunk,
    stopRecording,
    cancelRecording,
    simulateLateOnstop,
    onRecorded,
    onCancel,
  };
}

describe("AudioRecorder cancel logic", () => {
  let recorder: ReturnType<typeof createRecorderLogic>;

  beforeEach(() => {
    recorder = createRecorderLogic();
  });

  it("should call onRecorded when stopping normally", () => {
    recorder.startRecording();
    recorder.addChunk("audio-data-1");
    recorder.addChunk("audio-data-2");
    recorder.stopRecording();

    expect(recorder.onRecorded).toHaveBeenCalledTimes(1);
    expect(recorder.onRecorded).toHaveBeenCalledWith(
      expect.objectContaining({ size: 2 })
    );
    expect(recorder.onCancel).not.toHaveBeenCalled();
  });

  it("should NOT call onRecorded when cancelled", () => {
    recorder.startRecording();
    recorder.addChunk("audio-data-1");
    recorder.cancelRecording();

    expect(recorder.onRecorded).not.toHaveBeenCalled();
    expect(recorder.onCancel).toHaveBeenCalledTimes(1);
  });

  it("should NOT send audio on late onstop callback after cancel", () => {
    recorder.startRecording();
    recorder.addChunk("audio-data-1");
    recorder.cancelRecording();

    // Simulate onstop firing again after cancel (race condition)
    recorder.simulateLateOnstop();

    expect(recorder.onRecorded).not.toHaveBeenCalled();
  });

  it("should work correctly: cancel -> new recording -> send", () => {
    // First recording: cancel
    recorder.startRecording();
    recorder.addChunk("cancelled-data");
    recorder.cancelRecording();

    expect(recorder.onRecorded).not.toHaveBeenCalled();

    // Second recording: send
    recorder.startRecording();
    recorder.addChunk("real-data");
    recorder.stopRecording();

    expect(recorder.onRecorded).toHaveBeenCalledTimes(1);
    expect(recorder.onRecorded).toHaveBeenCalledWith(
      expect.objectContaining({ size: 1 })
    );
  });

  it("should reset cancelled flag on new recording after cancel", () => {
    recorder.startRecording();
    recorder.cancelRecording();

    // Start fresh
    recorder.startRecording();
    recorder.addChunk("data");
    recorder.stopRecording();

    // Must send because cancelledRef was reset in startRecording
    expect(recorder.onRecorded).toHaveBeenCalledTimes(1);
  });

  it("should handle cancel with no chunks gracefully", () => {
    recorder.startRecording();
    // Cancel immediately without recording any data
    recorder.cancelRecording();

    expect(recorder.onRecorded).not.toHaveBeenCalled();
    expect(recorder.onCancel).toHaveBeenCalledTimes(1);
  });
});
