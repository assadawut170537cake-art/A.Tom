import { LAYOUT, PERSONAS } from './index';

/**
 * Self-contained HTML for the 3D Orb (raw WebGL, no CDN, works offline).
 *
 * Bridge API (called from React Native via injectJavaScript):
 *   window.setOrbPersona(1 | 2 | 3 | 4)
 *   window.setOrbState('IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING')
 *
 * At the end of window.onload the page posts {type:'ready'} so RN knows it can
 * start flushing its queued calls.
 */

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const PERSONA_COLORS = JSON.stringify(
  Object.fromEntries(Object.values(PERSONAS).map((p) => [p.id, hexToRgb(p.color)]))
);

const SIZE = LAYOUT.orb.nativeSize;

export const ORB_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  body { display: flex; align-items: center; justify-content: center; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  canvas { width: ${SIZE}px; height: ${SIZE}px; display: block; background: transparent; }
  #fallback { display: none; width: 62%; height: 62%; border-radius: 50%; }
</style>
</head>
<body>
<canvas id="orb"></canvas>
<div id="fallback"></div>
<script>
(function () {
  var COLORS = ${PERSONA_COLORS};
  var STATES = {
    IDLE:      { speed: 0.35, amp: 0.025, glow: 0.55, ring: 0.0, swirl: 0.0, pulse: 0.0 },
    LISTENING: { speed: 0.80, amp: 0.045, glow: 0.75, ring: 1.0, swirl: 0.0, pulse: 0.0 },
    THINKING:  { speed: 1.60, amp: 0.035, glow: 0.60, ring: 0.0, swirl: 1.0, pulse: 0.0 },
    SPEAKING:  { speed: 1.10, amp: 0.070, glow: 0.95, ring: 0.0, swirl: 0.0, pulse: 1.0 }
  };
  var KEYS = ['speed', 'amp', 'glow', 'ring', 'swirl', 'pulse'];

  var cur = {}; var target = STATES.IDLE;
  for (var k = 0; k < KEYS.length; k++) cur[KEYS[k]] = STATES.IDLE[KEYS[k]];
  var color = COLORS[1].slice(); var targetColor = COLORS[1].slice(); var colorInit = false;

  function applyFallback() {
    var fb = document.getElementById('fallback');
    var c = 'rgb(' + targetColor.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
    fb.style.background = 'radial-gradient(circle at 35% 30%, #ffffff55, ' + c + ' 45%, #000000 100%)';
    fb.style.boxShadow = '0 0 40px ' + c;
  }

  window.setOrbPersona = function (p) {
    var c = COLORS[p];
    if (!c) return;
    targetColor = c.slice();
    if (!colorInit) { color = c.slice(); colorInit = true; }
    if (!gl) applyFallback();
  };
  window.setOrbState = function (s) {
    var st = STATES[String(s).toUpperCase()];
    if (st) target = st;
  };

  var canvas = document.getElementById('orb');
  var gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true })
      || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true });
  } catch (e) { gl = null; }

  var VERT = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes; uniform float uTime; uniform vec3 uColor;',
    'uniform float uAmp; uniform float uGlow; uniform float uRing; uniform float uSwirl; uniform float uPulse; uniform float uPhase;',
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}',
    'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
    'float snoise(vec3 v){',
    '  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);',
    '  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);',
    '  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);',
    '  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;',
    '  i=mod289(i);',
    '  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
    '  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;',
    '  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);',
    '  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);',
    '  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);',
    '  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));',
    '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
    '  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);',
    '  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
    '  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;',
    '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;',
    '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
    '}',
    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/(0.5*min(uRes.x,uRes.y));',
    '  float r=length(uv);',
    '  vec2 dir=r>0.0001?uv/r:vec2(1.0,0.0);',
    '  float t=uPhase;',
    '  float voice=0.5+0.5*sin(uTime*9.0)*sin(uTime*3.7+1.3);',
    '  float R=0.56+uPulse*0.05*voice;',
    '  float Rd=R+snoise(vec3(dir*1.3,t))*uAmp;',
    '  vec3 col=vec3(0.0); float a=0.0;',
    '  if(r<Rd+0.02){',
    '    float z=sqrt(max(Rd*Rd-r*r,0.0));',
    '    vec3 n=normalize(vec3(uv,z));',
    '    float ang=uSwirl*uTime*1.8;',
    '    mat2 rot=mat2(cos(ang),-sin(ang),sin(ang),cos(ang));',
    '    vec3 q=vec3(rot*n.xy,n.z);',
    '    float inner=snoise(q*2.4+vec3(0.0,0.0,t*1.4));',
    '    float bands=uSwirl*smoothstep(0.35,0.9,sin(atan(q.y,q.x)*3.0+uTime*4.0+inner*2.0));',
    '    vec3 L=normalize(vec3(-0.45,0.55,0.8));',
    '    float diff=max(dot(n,L),0.0);',
    '    float spec=pow(max(dot(reflect(-L,n),vec3(0.0,0.0,1.0)),0.0),28.0);',
    '    float fres=pow(1.0-n.z,2.2);',
    '    col=uColor*(0.18+0.55*diff)+uColor*fres*1.3+vec3(spec)*0.55+uColor*inner*0.22+uColor*bands*0.35;',
    '    col=mix(col,vec3(1.0),0.12*fres);',
    '    a=smoothstep(Rd+0.01,Rd-0.01,r);',
    '  }',
    '  float d=max(r-Rd,0.0);',
    '  float glow=uGlow*exp(-d*7.5)*smoothstep(Rd-0.05,Rd,r);',
    '  float wave=fract(uTime*0.7);',
    '  float ring=uRing*(1.0-wave)*smoothstep(0.025,0.0,abs(r-(Rd+0.04+0.3*wave)));',
    '  float ga=clamp(glow*0.55+ring*0.8,0.0,1.0);',
    '  vec3 rgb=col*a+uColor*ga*(1.0-a);',
    '  float outA=a+ga*(1.0-a);',
    '  gl_FragColor=vec4(min(rgb,vec3(outA)),outA);',
    '}'
  ].join('\\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  var U = {};
  function setupGL() {
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uRes', 'uTime', 'uColor', 'uAmp', 'uGlow', 'uRing', 'uSwirl', 'uPulse', 'uPhase'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = ${SIZE} * dpr;
    canvas.height = ${SIZE} * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
  }

  function useFallback() {
    gl = null;
    canvas.style.display = 'none';
    document.getElementById('fallback').style.display = 'block';
    applyFallback();
  }

  var last = 0; var time = 0; var phase = 0; var raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    var f = 1 - Math.exp(-dt * 5);
    for (var i = 0; i < KEYS.length; i++) cur[KEYS[i]] += (target[KEYS[i]] - cur[KEYS[i]]) * f;
    for (var c = 0; c < 3; c++) color[c] += (targetColor[c] - color[c]) * f;
    time += dt;
    phase += dt * cur.speed;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uPhase, phase);
    gl.uniform3f(U.uColor, color[0], color[1], color[2]);
    gl.uniform1f(U.uAmp, cur.amp);
    gl.uniform1f(U.uGlow, cur.glow);
    gl.uniform1f(U.uRing, cur.ring);
    gl.uniform1f(U.uSwirl, cur.swirl);
    gl.uniform1f(U.uPulse, cur.pulse);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  document.addEventListener('visibilitychange', function () {
    if (!gl) return;
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  });
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); cancelAnimationFrame(raf); useFallback(); });

  window.onload = function () {
    if (gl) {
      try { setupGL(); raf = requestAnimationFrame(frame); } catch (e) { useFallback(); }
    } else {
      useFallback();
    }
    window.__orbReady = true;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    }
  };
})();
</script>
</body>
</html>`;
