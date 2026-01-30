chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAY_SOUND') {
    // Poll started - full volume, normal speed
    const audio = document.getElementById('notification-sound');
    audio.volume = 1.0;
    audio.playbackRate = 1.0;
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio play failed:', e));
  } else if (message.type === 'PLAY_SOUND_END') {
    // Poll ended - quieter, slightly lower pitch
    const audio = document.getElementById('notification-sound');
    audio.volume = 0.4;
    audio.playbackRate = 0.8;
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio play failed:', e));
  }
});
