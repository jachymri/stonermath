(() => {
  'use strict';

  const canvas = document.querySelector('#plot');
  const wrap = document.querySelector('#plot-wrap');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const $ = (s) => document.querySelector(s);
  const state = { center: [0, 0], scale: 4, expression: 'z^3 - 1', contrast: 1, chroma: .18, contours: false, grid: true };

  if (!gl) {
    wrap.innerHTML = '<div style="padding:40px;font-family:monospace">WebGL 2 is required to run Complex Atlas.</div>';
    return;
  }

  // Pratt parser: expression text → compact GLSL complex arithmetic.
  const funcs = new Set(['sin','cos','tan','exp','log','sqrt','abs','conj','sinh','cosh','tanh']);
  function tokenize(source) {
    const out = []; let i = 0;
    while (i < source.length) {
      const c = source[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = source.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
        if (!m) throw Error(`Bad number at ${i + 1}`);
        out.push({ t: 'num', v: m[0] }); i += m[0].length; continue;
      }
      if (/[a-zA-Z_]/.test(c)) {
        const m = source.slice(i).match(/^[a-zA-Z_][a-zA-Z_0-9]*/)[0];
        out.push({ t: 'id', v: m.toLowerCase() }); i += m.length; continue;
      }
      if ('+-*/^(),'.includes(c)) { out.push({ t: c, v: c }); i++; continue; }
      throw Error(`Unexpected “${c}” at ${i + 1}`);
    }
    out.push({ t: 'eof' }); return out;
  }

  function compile(source) {
    const tokens = tokenize(source); let p = 0;
    const peek = () => tokens[p];
    const take = (t) => { if (peek().t !== t) throw Error(`Expected “${t}”`); return tokens[p++]; };
    const parse = (min = 0) => {
      let left; const tok = tokens[p++];
      if (tok.t === 'num') left = `vec2(${Number(tok.v).toFixed(9)},0.)`;
      else if (tok.t === 'id') {
        if (tok.v === 'z') left = 'z';
        else if (tok.v === 'i') left = 'vec2(0.,1.)';
        else if (tok.v === 'pi') left = 'vec2(PI,0.)';
        else if (tok.v === 'e') left = 'vec2(2.718281828,0.)';
        else if (funcs.has(tok.v)) { take('('); const arg = parse(); take(')'); left = `c_${tok.v}(${arg})`; }
        else throw Error(`Unknown name “${tok.v}”`);
      } else if (tok.t === '(') { left = parse(); take(')'); }
      else if (tok.t === '+') left = parse(40);
      else if (tok.t === '-') left = `-(${parse(40)})`;
      else throw Error('Expected a number, z, or function');

      const prec = { '+': 10, '-': 10, '*': 20, '/': 20, '^': 30 };
      while (prec[peek().t] > min) {
        const op = tokens[p++].t;
        const right = parse(op === '^' ? prec[op] - 1 : prec[op]);
        left = op === '+' ? `c_add(${left},${right})` : op === '-' ? `c_sub(${left},${right})` : op === '*' ? `c_mul(${left},${right})` : op === '/' ? `c_div(${left},${right})` : `c_pow(${left},${right})`;
      }
      return left;
    };
    const code = parse();
    if (peek().t !== 'eof') throw Error(`Unexpected “${peek().v}”`);
    return code;
  }

  const vertex = `#version 300 es
  in vec2 a_position;
  void main(){ gl_Position=vec4(a_position,0.,1.); }`;

  function fragment(expression) { return `#version 300 es
  precision highp float;
  out vec4 outColor;
  uniform vec2 u_resolution, u_center;
  uniform float u_scale, u_contrast, u_chroma;
  uniform bool u_contours, u_grid;
  #define PI 3.141592653589793
  vec2 c_add(vec2 a,vec2 b){return a+b;} vec2 c_sub(vec2 a,vec2 b){return a-b;}
  vec2 c_mul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
  vec2 c_div(vec2 a,vec2 b){float d=max(dot(b,b),1e-30);return vec2(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/d;}
  vec2 c_exp(vec2 z){return exp(clamp(z.x,-80.,80.))*vec2(cos(z.y),sin(z.y));}
  vec2 c_log(vec2 z){return vec2(log(max(length(z),1e-30)),atan(z.y,z.x));}
  vec2 c_pow(vec2 a,vec2 b){return c_exp(c_mul(b,c_log(a)));}
  vec2 c_sin(vec2 z){return vec2(sin(z.x)*cosh(z.y),cos(z.x)*sinh(z.y));}
  vec2 c_cos(vec2 z){return vec2(cos(z.x)*cosh(z.y),-sin(z.x)*sinh(z.y));}
  vec2 c_tan(vec2 z){return c_div(c_sin(z),c_cos(z));}
  vec2 c_sinh(vec2 z){return vec2(sinh(z.x)*cos(z.y),cosh(z.x)*sin(z.y));}
  vec2 c_cosh(vec2 z){return vec2(cosh(z.x)*cos(z.y),sinh(z.x)*sin(z.y));}
  vec2 c_tanh(vec2 z){return c_div(c_sinh(z),c_cosh(z));}
  vec2 c_sqrt(vec2 z){float r=sqrt(length(z)),a=.5*atan(z.y,z.x);return r*vec2(cos(a),sin(a));}
  vec2 c_abs(vec2 z){return vec2(length(z),0.);} vec2 c_conj(vec2 z){return vec2(z.x,-z.y);}

  vec3 oklabToLinear(vec3 c){
    float l=c.x+.3963377774*c.y+.2158037573*c.z, m=c.x-.1055613458*c.y-.0638541728*c.z, s=c.x-.0894841775*c.y-1.291485548*c.z;
    l=l*l*l; m=m*m*m; s=s*s*s;
    return vec3(4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s);
  }
  vec3 linearToSrgb(vec3 c){return mix(12.92*c,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
  float gridLine(float x,float stepSize,float px){float d=abs(fract(x/stepSize+.5)-.5)*stepSize;return 1.-smoothstep(px,px*1.8,d);}
  void main(){
    float aspect=u_resolution.x/u_resolution.y;
    vec2 uv=(gl_FragCoord.xy/u_resolution-.5)*vec2(aspect,1.)*u_scale;
    vec2 z=u_center+uv;
    vec2 w=${expression};
    float mag=length(w), phase=atan(w.y,w.x);
    float logMag=log2(max(mag,1e-20));
    float L=.16+.68*(.5+.5*tanh(logMag*u_contrast*.34));
    if(u_contours){float band=.5+.5*cos(6.2831853*logMag);L*=.91+.09*smoothstep(-.6,1.,band);}
    float C=u_chroma*(.82+.18*cos(logMag*1.7));
    vec3 col=linearToSrgb(oklabToLinear(vec3(L,C*cos(phase),C*sin(phase))));
    if(u_grid){
      float target=u_scale/7., decade=pow(10.,floor(log(target)/log(10.))), n=target/decade;
      float gs=decade*(n<2.?1.:n<5.?2.:5.); float px=u_scale/u_resolution.y;
      float minor=max(gridLine(z.x,gs,px),gridLine(z.y,gs,px));
      float axes=max(1.-smoothstep(px,px*2.,abs(z.x)),1.-smoothstep(px,px*2.,abs(z.y)));
      col=mix(col,vec3(.82,.86,.9),minor*.15+axes*.28);
    }
    float finiteMask=float(!(isnan(mag)||isinf(mag))); col*=finiteMask;
    outColor=vec4(clamp(col,0.,1.),1.);
  }`; }

  function makeShader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s).split('\n')[0]);
    return s;
  }

  let program, uniforms = {};
  function buildProgram(expression) {
    const expr = compile(expression);
    const next = gl.createProgram();
    gl.attachShader(next, makeShader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(next, makeShader(gl.FRAGMENT_SHADER, fragment(expr)));
    gl.linkProgram(next);
    if (!gl.getProgramParameter(next, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(next));
    if (program) gl.deleteProgram(program); program = next; gl.useProgram(program);
    const pos = gl.getAttribLocation(program, 'a_position');
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    uniforms = Object.fromEntries(['resolution','center','scale','contrast','chroma','contours','grid'].map(k => [k, gl.getUniformLocation(program, `u_${k}`)]));
    state.expression = expression; needsRender = true;
  }

  let needsRender = true, frameCount = 0, fpsStart = performance.now();
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; needsRender = true; }
  }
  function render(t) {
    resize();
    if (needsRender && program) {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height); gl.uniform2fv(uniforms.center, state.center);
      gl.uniform1f(uniforms.scale, state.scale); gl.uniform1f(uniforms.contrast, state.contrast); gl.uniform1f(uniforms.chroma, state.chroma);
      gl.uniform1i(uniforms.contours, state.contours); gl.uniform1i(uniforms.grid, state.grid);
      gl.drawArrays(gl.TRIANGLES, 0, 3); needsRender = false; frameCount++;
    }
    if (t - fpsStart > 1000) { $('#fps').textContent = `${Math.round(frameCount * 1000 / (t - fpsStart)) || 60} FPS`; frameCount = 0; fpsStart = t; }
    requestAnimationFrame(render);
  }

  function updateView() {
    $('#center-output').value = `${fmt(state.center[0], 2)} ${state.center[1] < 0 ? '−' : '+'} ${Math.abs(state.center[1]).toFixed(2)}i`;
    $('#scale-output').value = state.scale.toFixed(state.scale < .1 ? 4 : 2);
    const level = Math.max(0, Math.min(1, (Math.log10(4 / state.scale) + 4) / 8));
    $('#zoom-level').style.left = `${level * 100}%`; needsRender = true;
  }
  const fmt = (v, n = 3) => Math.abs(v) < .5 * 10 ** -n ? (0).toFixed(n) : v.toFixed(n);
  function screenToComplex(x, y) {
    const r = canvas.getBoundingClientRect(), aspect = r.width / r.height;
    return [state.center[0] + ((x-r.left)/r.width-.5)*aspect*state.scale, state.center[1] - ((y-r.top)/r.height-.5)*state.scale];
  }
  function zoom(factor, x = wrap.clientWidth / 2, y = wrap.clientHeight / 2) {
    const r = canvas.getBoundingClientRect(), before = screenToComplex(r.left+x, r.top+y);
    state.scale = Math.max(1e-7, Math.min(1e7, state.scale * factor));
    const after = screenToComplex(r.left+x, r.top+y);
    state.center[0] += before[0]-after[0]; state.center[1] += before[1]-after[1]; updateView();
  }

  let dragging = false, last = [0,0], pinchDistance = 0;
  wrap.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * .001), e.clientX-wrap.getBoundingClientRect().left, e.clientY-wrap.getBoundingClientRect().top); }, { passive: false });
  wrap.addEventListener('pointerdown', e => { dragging = true; last = [e.clientX,e.clientY]; wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', e => {
    const z = screenToComplex(e.clientX, e.clientY); $('#coord-re').textContent=fmt(z[0]); $('#coord-im').textContent=fmt(z[1]); $('#coord-mag').textContent='—';
    if (!dragging) return; const r=canvas.getBoundingClientRect(), dx=e.clientX-last[0], dy=e.clientY-last[1];
    state.center[0]-=dx/r.height*state.scale; state.center[1]+=dy/r.height*state.scale; last=[e.clientX,e.clientY]; updateView();
  });
  wrap.addEventListener('pointerup', () => dragging=false); wrap.addEventListener('pointercancel', () => dragging=false);
  wrap.addEventListener('dblclick', e => zoom(.5, e.clientX-wrap.getBoundingClientRect().left, e.clientY-wrap.getBoundingClientRect().top));

  function showError(message) { const el=$('#error-toast'); el.textContent=message; el.classList.add('show'); clearTimeout(showError.timer); showError.timer=setTimeout(()=>el.classList.remove('show'),3000); }
  function applyExpression(value) {
    try { buildProgram(value); $('#valid-indicator').textContent='✓'; $('#valid-indicator').classList.remove('invalid'); $('#error-toast').classList.remove('show'); }
    catch (e) { $('#valid-indicator').textContent='!'; $('#valid-indicator').classList.add('invalid'); showError(e.message); }
  }
  $('#function-form').addEventListener('submit', e => { e.preventDefault(); applyExpression($('#expression').value); document.activeElement.blur(); });
  $('#expression').addEventListener('input', () => { try { compile($('#expression').value); $('#valid-indicator').textContent='✓'; $('#valid-indicator').classList.remove('invalid'); } catch { $('#valid-indicator').textContent='!'; $('#valid-indicator').classList.add('invalid'); } });
  $('#presets').addEventListener('click', e => { const b=e.target.closest('button'); if(!b)return; document.querySelectorAll('.presets button').forEach(x=>x.classList.toggle('active',x===b)); $('#expression').value=b.dataset.expression; applyExpression(b.dataset.expression); });
  $('#reset-view').addEventListener('click', () => { state.center=[0,0]; state.scale=4; updateView(); });
  $('#zoom-in').addEventListener('click', () => zoom(.7)); $('#zoom-out').addEventListener('click', () => zoom(1/.7));
  $('#panel-toggle').addEventListener('click', e => { const closed=$('#control-panel').classList.toggle('closed'); e.currentTarget.setAttribute('aria-expanded',!closed); setTimeout(()=>{resize(); needsRender=true;},300); });
  [['brightness','contrast'],['chroma','chroma']].forEach(([id,key]) => $('#'+id).addEventListener('input', e => { state[key]=+e.target.value; $('#'+id+'-output').value=(+e.target.value).toFixed(2); const pct=(e.target.value-e.target.min)/(e.target.max-e.target.min)*100; e.target.style.background=`linear-gradient(90deg,var(--accent) ${pct}%,#343940 ${pct}%)`; needsRender=true; }));
  [['contours','contours'],['grid','grid']].forEach(([id,key]) => $('#'+id).addEventListener('change',e=>{state[key]=e.target.checked;needsRender=true;}));
  window.addEventListener('keydown', e => { if(document.activeElement.tagName==='INPUT')return; const n=+e.key; if(n>=1&&n<=6) document.querySelectorAll('.presets button')[n-1].click(); if(e.key==='0'){state.center=[0,0];state.scale=4;updateView();} });
  window.addEventListener('resize', () => needsRender=true);

  // Optional rewarded discovery. A real provider is configured in ad-config.js.
  const rewardDialog = $('#reward-dialog');
  const rewardOffer = $('#reward-offer');
  const adStage = $('#ad-stage');
  const adStatus = $('#ad-status');
  const rewardFunction = $('#reward-function');
  const storage = {
    get: key => { try { return sessionStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { sessionStorage.setItem(key, value); } catch {} }
  };

  function closeReward(result) {
    storage.set('complex-atlas-reward-prompt', result);
    if (rewardDialog.open) rewardDialog.close();
  }
  function unlockReward() {
    rewardFunction.hidden = false;
    rewardFunction.click();
    rewardFunction.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function runDemoAd() {
    // Development fallback: clearly labeled and never represented as a paid ad.
    for (let remaining = 5; remaining > 0; remaining--) {
      adStatus.textContent = `Demo placement · unlocking in ${remaining}s`;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  $('#decline-reward').addEventListener('click', () => closeReward('declined'));
  rewardDialog.addEventListener('cancel', e => { e.preventDefault(); closeReward('declined'); });
  $('#accept-reward').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    rewardOffer.hidden = true; adStage.hidden = false;
    try {
      if (window.COMPLEX_ATLAS_AD?.showRewarded) {
        adStatus.textContent = 'Ad in progress…';
        await window.COMPLEX_ATLAS_AD.showRewarded();
      } else {
        await runDemoAd();
      }
      adStatus.textContent = 'Unlocked — loading function…';
      unlockReward(); closeReward('completed');
    } catch (error) {
      adStatus.textContent = 'The ad was unavailable. Please try again later.';
      e.currentTarget.disabled = false;
      setTimeout(() => closeReward('unavailable'), 1800);
    }
  });

  if (storage.get('complex-atlas-reward-prompt') === 'completed') rewardFunction.hidden = false;
  else if (!storage.get('complex-atlas-reward-prompt')) setTimeout(() => rewardDialog.showModal(), 1200);

  applyExpression(state.expression); updateView(); requestAnimationFrame(render);
})();
