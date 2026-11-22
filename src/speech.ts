let voicesReady = false;

function frenchVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const norm = (lang: string) => lang.toLowerCase().replaceAll('_', '-');
  return (
    voices.find((voice) => norm(voice.lang) === 'fr-fr') ??
    voices.find((voice) => norm(voice.lang).startsWith('fr')) ??
    null
  );
}

export function prepareVoices(): void {
  if (voicesReady || !('speechSynthesis' in window)) return;
  voicesReady = true;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices();
  });
}

export function canSpeak(): boolean {
  return 'speechSynthesis' in window;
}

/** Speak French. Call this directly from a tap so iOS Safari allows it. */
export function speakFrench(text: string): void {
  if (!canSpeak() || !text.trim()) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'fr-FR';
  utter.rate = 0.92;
  const voice = frenchVoice();
  if (voice) utter.voice = voice;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }
  window.speechSynthesis.speak(utter);
}

export function stopSpeech(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
