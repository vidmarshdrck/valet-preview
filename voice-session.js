'use strict';
/**
 * Voice conversation state for Bags.
 * The orb label is the session lifecycle. Typing does not end a session.
 * Personality and mute do not grant extra permissions.
 */

function createVoiceSession() {
  return {
    active: false,
    muted: false,
    speaking: false,
    processing: false,
    listening: false,
    error: '',
    composerText: '',
    transcript: [],
  };
}

function voiceOrbState(session) {
  if (!session) return 'IDLE';
  if (session.error) return 'ERROR';
  if (!session.active) return session.muted ? 'MUTED' : 'IDLE';
  if (session.muted) return 'MUTED';
  if (session.processing) return 'PROCESSING';
  if (session.speaking) return 'SPEAKING';
  if (session.listening) return 'LISTENING';
  return 'PROCESSING';
}

function beginVoiceSession(session) {
  session.active = true;
  session.error = '';
  session.speaking = false;
  session.processing = false;
  session.listening = false;
  return session;
}

function noteMicrophoneOpen(session) {
  if (!session.active || session.muted || session.speaking || session.processing) return session;
  session.listening = true;
  session.error = '';
  return session;
}

function noteMicrophoneClosed(session) {
  session.listening = false;
  return session;
}

function captureSpokenLine(session, text) {
  const line = String(text || '').trim();
  if (!session.active || !line) return session;
  session.transcript.push({ role: 'user', source: 'speech', text: line });
  session.listening = false;
  session.speaking = false;
  session.processing = true;
  return session;
}

function rememberComposerText(session, text) {
  session.composerText = String(text ?? '');
  return session;
}

/** A typed line joins the same transcript and leaves the voice session running. */
function acceptTypedMessage(session, text) {
  const line = String(text || '').trim();
  if (!session.active || !line) return { accepted: false, sessionRemainsActive: !!session.active };
  session.transcript.push({ role: 'user', source: 'typing', text: line });
  session.listening = false;
  session.speaking = false;
  session.processing = true;
  return { accepted: true, sessionRemainsActive: true };
}

function beginSpeakingReply(session) {
  session.processing = false;
  if (!session.active || session.muted) {
    session.speaking = false;
    return session;
  }
  session.listening = false;
  session.speaking = true;
  return session;
}

function finishSpeakingReply(session) {
  session.speaking = false;
  session.processing = false;
  if (session.active && !session.muted && !session.error) session.listening = true;
  return session;
}

function noteReplyFailed(session) {
  session.processing = false;
  session.speaking = false;
  if (session.active && !session.muted && !session.error) session.listening = true;
  return session;
}

function muteVoice(session) {
  session.muted = true;
  session.listening = false;
  session.speaking = false;
  return session;
}

function unmuteVoice(session) {
  session.muted = false;
  if (session.active && !session.processing && !session.error) session.listening = true;
  return session;
}

function noteVoiceError(session, message) {
  session.error = message || 'Voice failed';
  session.active = false;
  session.listening = false;
  session.speaking = false;
  session.processing = false;
  return session;
}

function endVoiceSession(session) {
  session.active = false;
  session.listening = false;
  session.speaking = false;
  session.processing = false;
  session.error = '';
  return session;
}

window.createVoiceSession = createVoiceSession;
window.voiceOrbState = voiceOrbState;
window.beginVoiceSession = beginVoiceSession;
window.noteMicrophoneOpen = noteMicrophoneOpen;
window.noteMicrophoneClosed = noteMicrophoneClosed;
window.captureSpokenLine = captureSpokenLine;
window.rememberComposerText = rememberComposerText;
window.acceptTypedMessage = acceptTypedMessage;
window.beginSpeakingReply = beginSpeakingReply;
window.finishSpeakingReply = finishSpeakingReply;
window.noteReplyFailed = noteReplyFailed;
window.muteVoice = muteVoice;
window.unmuteVoice = unmuteVoice;
window.noteVoiceError = noteVoiceError;
window.endVoiceSession = endVoiceSession;
