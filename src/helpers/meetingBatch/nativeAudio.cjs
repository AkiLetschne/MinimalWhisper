function pcmChunkStartedAt(arrivedAt, byteLength, sampleRate, channels) {
  return arrivedAt - (byteLength / (sampleRate * 2 * channels)) * 1000;
}

module.exports = { pcmChunkStartedAt };
