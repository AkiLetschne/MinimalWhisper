const getDisplayCaptureOptions = (mode: "loopback" | "portal") => {
  if (mode === "loopback") {
    return { video: true, audio: true };
  }

  return {
    video: true,
    audio: true,
    systemAudio: "include",
    windowAudio: "system",
    selfBrowserSurface: "exclude",
  } as DisplayMediaStreamOptions & {
    systemAudio?: "include";
    windowAudio?: "system";
    selfBrowserSurface?: "exclude";
  };
};

export const requestSystemAudioDisplayStream = async (mode: "loopback" | "portal") => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(getDisplayCaptureOptions(mode));
    const audioTrack = stream.getAudioTracks()[0];

    if (!audioTrack) {
      stream.getTracks().forEach((track) => track.stop());
      return { stream: null, error: new Error("No system-audio track was returned.") };
    }

    stream.getVideoTracks().forEach((track) => track.stop());
    return { stream, error: null };
  } catch (error) {
    return { stream: null, error: error as Error };
  }
};
