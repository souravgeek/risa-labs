'use client';

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { MAX_CALL_MS, VOICE_TOOLS, type Utterance, type VoiceCredentials, type VoiceTool } from './voice-types';

export interface BrowserVoiceOptions {
  credentials: VoiceCredentials;
  onTranscript: (turn:Utterance) => unknown | Promise<unknown>;
  onTool: (name:VoiceTool,args:Record<string,unknown>) => unknown | Promise<unknown>;
  onEnd: (reason:string) => unknown;
  onError?: (message:string) => unknown;
  signal?: AbortSignal;
}

// Downsample to 16 kHz and average each input interval before converting to little-endian PCM.
const recorder = `
class CampusFestRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(1600); this.index = 0; this.phase = 0; this.sum = 0; this.count = 0; }
  process(inputs) {
    const frame = inputs[0] && inputs[0][0];
    if (!frame) return true;
    for (let i = 0; i < frame.length; i++) {
      this.sum += frame[i]; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const v = Math.min(1, Math.max(-1, this.sum / this.count));
        this.samples[this.index++] = v < 0 ? v * 32768 : v * 32767;
        this.sum = 0; this.count = 0;
        if (this.index === this.samples.length) {
          this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
          this.samples = new Int16Array(1600); this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('campusfest-recorder', CampusFestRecorder);`;

export async function startBrowserVoice(options: BrowserVoiceOptions): Promise<{stop:()=>void}> {
  const { credentials, signal }=options;
  if(!credentials.token.startsWith('auth_tokens/')) throw new Error('A single-use Gemini voice token is required.');
  if(!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error('Browser voice needs microphone access in a secure browser window.');
  if(signal?.aborted) throw new Error('Call cancelled.');
  const remaining=Date.parse(credentials.expiresAt)-Date.now();
  if(!(remaining>0)) throw new Error('The voice token has expired. Start a new call.');
  let audio:AudioContext | undefined, stream:MediaStream | undefined, source:MediaStreamAudioSourceNode | undefined;
  let worklet:AudioWorkletNode | undefined, session:Session | undefined, timer:ReturnType<typeof setTimeout> | undefined;
  let ended=false, nextPlayback=0, micActive=false, ready=false, notified=false;
  let pendingTranscript=Promise.resolve();
  let activeSpeaker:Utterance['speaker']|undefined, pendingText='';
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  const cancelledTools=new Set<string>();
  const playing=new Set<AudioBufferSourceNode>();
  const report=(e:unknown)=>options.onError?.(e instanceof Error?e.message:String(e));
  function flush() {
    const turn=activeSpeaker && pendingText.trim()?{speaker:activeSpeaker,text:pendingText.trim()}:undefined;
    activeSpeaker=undefined; pendingText='';
    if(turn) pendingTranscript=pendingTranscript.then(async()=>{await options.onTranscript(turn);}).catch(report).then(()=>undefined);
  }
  function transcribe(speaker:Utterance['speaker'],text:string,finished?:boolean){
    if(activeSpeaker && activeSpeaker!==speaker) flush();
    activeSpeaker=speaker; pendingText+=text;
    if(finished) flush();
  }
  function silence() {
    for (const node of playing) {try{node.stop();}catch{/* Already finished. */}}
    playing.clear(); nextPlayback=0;
  }
  const abort=()=>stop('cancelled');
  function stop(reason:string) {
    if(ended) return;
    ended=true; clearTimeout(timer); clearInterval(heartbeat); signal?.removeEventListener('abort',abort);
    silence(); source?.disconnect(); worklet?.disconnect(); worklet?.port.close();
    stream?.getTracks().forEach(track=>track.stop()); session?.close();
    if(audio && audio.state!=='closed') void audio.close().catch(report);
    flush();
    if(ready && !notified) {notified=true;void pendingTranscript.then(()=>options.onEnd(reason)).catch(report);}
  }
  function playback(data:string,rate:number) {
    if(!audio || ended) return;
    const binary=atob(data);
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const samples=new DataView(bytes.buffer), size=Math.floor(bytes.length/2);
    if(!size) return;
    const buffer=audio.createBuffer(1,size,rate);
    const channel=buffer.getChannelData(0);
    for(let i=0;i<size;i++) channel[i]=samples.getInt16(i*2,true)/32768;
    const node=audio.createBufferSource();
    node.buffer=buffer; node.connect(audio.destination); playing.add(node);
    nextPlayback=Math.max(audio.currentTime+0.015,nextPlayback);
    node.onended=()=>{playing.delete(node);node.disconnect();};
    node.start(nextPlayback); nextPlayback+=buffer.duration;
  }
  async function handleMessage(msg:LiveServerMessage) {
    if(ended) return;
    const content=msg.serverContent;
    if(content?.interrupted) silence();
    if(content?.outputTranscription?.text) transcribe('agent',content.outputTranscription.text,content.outputTranscription.finished);
    if(content?.inputTranscription?.text) transcribe('sponsor',content.inputTranscription.text,content.inputTranscription.finished);
    for(const part of content?.modelTurn?.parts || []) {
      if(part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData.data) {
        playback(part.inlineData.data,Number(part.inlineData.mimeType.match(/rate=(\d+)/)?.[1])||24000);
      }
    }
    if(content?.turnComplete) {flush();micActive=true;}
    for(const id of msg.toolCallCancellation?.ids || []) cancelledTools.add(id);
    for(const call of msg.toolCall?.functionCalls || []) {
      const name=call.name as VoiceTool;
      if(ended || (call.id && cancelledTools.delete(call.id))) continue;
      flush();await pendingTranscript;
      let response:Record<string,unknown>;
      try {
        if(!VOICE_TOOLS.includes(name)) throw new Error('Unknown call tool.');
        const output=await options.onTool(name,call.args||{});
        response={output:output ?? 'recorded'};
      } catch {response={error:'The call tool could not complete.'};}
      if(ended) break;
      session?.sendToolResponse({functionResponses:[{id:call.id,name:call.name,response}]});
      if(name==='mark_opt_out' || name==='end_call') stop(name==='mark_opt_out' ? 'opt-out':'completed');
    }
  }
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>stop('time limit'),Math.min(remaining,MAX_CALL_MS));
  try {
    audio=new AudioContext();
    await audio.resume();
    if(ended) throw new Error('Call cancelled.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
    if(ended){stream.getTracks().forEach(track=>track.stop());throw new Error('Call cancelled.');}
    const url=URL.createObjectURL(new Blob([recorder],{type:'text/javascript'}));
    try {await audio.audioWorklet.addModule(url);} finally {URL.revokeObjectURL(url);}
    if(ended) throw new Error('Call cancelled.');
    source=audio.createMediaStreamSource(stream);
    worklet=new AudioWorkletNode(audio,'campusfest-recorder',{numberOfInputs:1,numberOfOutputs:0});
    worklet.port.onmessage=({data}:{data:ArrayBuffer})=>{
      if(!session || ended || !micActive)return;
      const bytes=new Uint8Array(data);
      try {
        const base64=btoa(String.fromCharCode(...bytes));
        session.sendRealtimeInput({audio:{data:base64,mimeType:'audio/pcm;rate=16000'}});
      } catch(error){report(error);stop('audio error');}
    };
    const ai=new GoogleGenAI({apiKey:credentials.token,httpOptions:{apiVersion:'v1beta'}});
    session=await ai.live.connect({model:credentials.model,config:{responseModalities:[Modality.AUDIO]},callbacks:{
      onmessage:msg=>void handleMessage(msg).catch(error=>{report(error);stop('connection error');}),
      onerror:()=>{report('Gemini Live could not maintain the voice connection.');stop('connection error');},
      onclose:()=>stop('disconnected'),
    }});
    if(ended){session.close();throw new Error('Voice connection was closed.');}
    source.connect(worklet);
    heartbeat=setInterval(flush,4000);
    ready=true;
    session.sendRealtimeInput({text:'Begin now with the exact required disclosure, then ask your first question.'});
    return {stop:()=>stop('hang-up')};
  } catch(error) {stop('setup failed');throw error;}
}
