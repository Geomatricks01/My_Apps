// Always-on microphone + spoken replies, built on the browser's Web Speech API.
// Recognition is paused while the app is talking so it doesn't hear itself.

export class Voice {
  constructor({ onFinal, onInterim, onState, onError } = {}) {
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.want = false; // the user wants the mic open
    this.running = false;
    this.speaking = false;
    this.speakToken = 0;
    this.backoff = 250;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.canSpeak = 'speechSynthesis' in window;
    if (!SR) return;
    const rec = (this.rec = new SR());
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onstart = () => {
      this.running = true;
      this.backoff = 250;
      this.emit();
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text && !this.speaking) this.onFinal(text);
        } else interim += r[0].transcript;
      }
      if (!this.speaking) this.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.want = false;
        this.onError('Microphone access was blocked. Allow the microphone for this site, then tap the mic to try again.');
      } else if (e.error === 'audio-capture') {
        this.want = false;
        this.onError('No microphone was found.');
      } else if (e.error === 'network') {
        this.backoff = Math.min(this.backoff * 2, 5000);
      }
    };
    rec.onend = () => {
      this.running = false;
      this.emit();
      // browsers end recognition after silence; keep the "call" open
      if (this.want && !this.speaking) setTimeout(() => this.startRec(), this.backoff);
    };
  }

  get state() {
    if (this.speaking) return 'speaking';
    if (this.want && this.supported) return 'listening';
    return 'off';
  }
  emit() {
    this.onState(this.state);
  }

  startRec() {
    if (!this.supported || !this.want || this.speaking || this.running) return;
    try {
      this.rec.start();
    } catch {
      /* already starting */
    }
  }

  start() {
    this.want = true;
    this.startRec();
    this.emit();
  }

  stop() {
    this.want = false;
    if (this.rec && this.running) this.rec.abort();
    this.emit();
  }

  // Say something out loud. Resolves when finished (or immediately if muted/unsupported).
  speak(text) {
    if (!this.canSpeak || !text) return Promise.resolve();
    const token = ++this.speakToken;
    return new Promise((resolve) => {
      this.speaking = true;
      if (this.rec && this.running) this.rec.abort();
      this.emit();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.rec?.lang || navigator.language || 'en-US';
      u.rate = 1.05;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (token === this.speakToken) {
          this.speaking = false;
          this.emit();
          // short gap so the tail of our own voice isn't picked up
          setTimeout(() => this.startRec(), 200);
        }
        resolve();
      };
      // some browsers never fire onend; don't leave the mic closed forever
      const timer = setTimeout(done, 2500 + text.length * 90);
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    });
  }

  hush() {
    if (this.canSpeak) window.speechSynthesis.cancel();
  }
}
