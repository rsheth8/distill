/* In-page controls shared by HTML papers and Distill's PDF reader. */
(() => {
  globalThis.distillStartReadAlong = async (elements, key) => {
    if (document.getElementById('distill-read-along') || !elements.length) return;
    const core = globalThis.DistillReadAlong;
    const m = core.model(elements.map(el => el.textContent));
    if (!m.words.length) return;
    const sentences = core.chunks(m.text);
    const token = core.session();
    let position = 0, playing = false, timer, follow = true, online = false, speaking = false;
    let restoreTouched = false;
    let lastPdfBlock = -1;
    const synth = window.speechSynthesis;
    const host = document.createElement('aside');
    host.id = 'distill-read-along';
    host.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483646;width:min(420px,calc(100vw - 24px));';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{color-scheme:light dark}section{background:light-dark(#fffaf3,#242424);color:light-dark(#222,#eee);border:1px solid #888;border-radius:12px;padding:10px;box-shadow:0 2px 16px #0003;font:14px/1.5 system-ui} .row{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}button,select,input{font:inherit;max-width:100%;min-height:32px}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #337bc4}input[type=number]{width:64px}select{min-width:0;flex:1}p{margin:4px 0;font-size:12px}details summary{cursor:pointer}button{cursor:pointer}
      </style><section aria-label="Read along"><details open><summary>Read along</summary>
      <div class="row"><label>Mode <select id="mode"><option value="silent">Silent</option><option value="voice">Narration</option></select></label><button id="play">Play</button><button id="stop">Stop</button><button id="prev" aria-label="Previous sentence">Previous</button><button id="next" aria-label="Next sentence or skip material">Next / skip</button></div>
      <div class="row"><label id="paceLabel">Silent WPM <input id="pace" type="number" min="60" max="600" step="10" value="220"></label><label id="rateLabel" hidden>Speech rate <input id="rate" type="number" min="0.5" max="2" step="0.1" value="1"></label></div>
      <div id="voiceControls" hidden><div class="row"><select id="voice" aria-label="Narration voice"></select><button id="preview">Preview</button><button id="refresh">Refresh voices</button></div><label><input id="online" type="checkbox"> Show optional online voices</label><p id="privacy">Local voices keep narration on this computer. Online voices send each spoken passage to the selected voice service; availability, account requirements and cost depend on that service. Selecting an online voice explicitly enables transmission for this session.</p></div>
      <div class="row"><button id="selection">Start from selection</button><button id="follow">Resume following</button><button id="source">Show Reading view</button></div>
      <p id="status" role="status">Ready. Select a passage or Alt-click a word to start there.</p><progress id="progress" aria-label="Reading position" max="100" value="0"></progress>
      </details></section>`;
    document.body.append(host);
    const $ = id => root.getElementById(id);
    const css = document.createElement('style');
    css.textContent = '::highlight(distill-word){background:#ffd966;color:#171717}::highlight(distill-sentence){background:#ffe8a080;color:inherit}';
    document.head.append(css);
    const status = text => { $('status').textContent = text; };
    const storageKey = `distill.readAlong.v1:${key}`;
    let saveTimer;
    const persist = () => chrome.storage.local.set({ [storageKey]: { position, length: m.text.length, sample: m.text.slice(0, 120), wpm: Number($('pace').value), rate: Number($('rate').value), voice: selectedVoice()?.localService ? selectedVoice().voiceURI : '' } }).catch(() => {});
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 300);
    };
    function selectedVoice() { return synth?.getVoices().find(v => v.voiceURI === $('voice').value); }
    function voices() {
      const old = $('voice').value;
      $('voice').replaceChildren();
      for (const v of synth?.getVoices() || []) {
        if (!v.localService && !online) continue;
        const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = `${v.name} · ${v.lang} · ${v.localService ? 'local' : 'ONLINE'}`; $('voice').append(o);
      }
      if ([...$('voice').options].some(o => o.value === old)) $('voice').value = old;
      else {
        const local = [...$('voice').options].find(o => synth.getVoices().some(v => v.voiceURI === o.value && v.localService));
        if (local) $('voice').value = local.value;
        else if ($('voice').options.length) {
          const prompt = document.createElement('option'); prompt.value = ''; prompt.textContent = 'Choose an online voice explicitly'; prompt.disabled = true;
          $('voice').prepend(prompt); $('voice').value = '';
        }
      }
      if (!$('voice').options.length) status('No installed local voice available. Refresh voices or use silent reading.');
    }
    // Source ranges survive glossary wrappers because offsets are resolved afresh.
    function domRange(el, start, end) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node, offset = 0, first, last;
      while ((node = walker.nextNode())) {
        if (node.nodeType === 1) { if (node.tagName === 'BR') offset++; continue; }
        const size = node.textContent.length;
        if (!first && start < offset + size) first = [node, Math.max(0, start - offset)];
        if (end <= offset + size && first) { last = [node, Math.max(0, end - offset)]; break; }
        offset += size;
      }
      if (!first || !last) return null;
      const r = document.createRange(); r.setStart(...first); r.setEnd(...last); return r;
    }
    function layerText(layer) {
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let text = '', node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === 3) text += node.textContent;
        else if (node.tagName === 'BR') text += '\n';
      }
      return text;
    }
    function sourceRange(start, end) {
      const index = m.blocks.findIndex(b => start >= b.start && start < b.end);
      if (index < 0) return null;
      const b = m.blocks[index];
      if (document.getElementById('reading')?.hidden) {
        // Require unique document context, preferring a block and then a bounded sentence.
        const sentence = sentences.find(c => c.start <= start && c.end > start);
        const contexts = [{ start: b.start, end: b.end }];
        if (sentence) contexts.push({ start: Math.max(b.start, sentence.start), end: Math.min(b.end, sentence.end) });
        for (const context of contexts) {
          const text = m.text.slice(context.start, context.end);
          const page = globalThis.distillPdfResolve?.(text);
          if (!page) continue;
          const layer = document.querySelector(`#pages [data-page="${page}"] .textLayer`);
          if (!layer) continue;
          const range = core.alignRange(layerText(layer), text, start - context.start, Math.min(end, context.end) - context.start);
          if (range) return domRange(layer, range.start, range.end);
        }
        return null;
      }
      return domRange(elements[index], start - b.start, Math.min(end, b.end) - b.start);
    }
    function paint(end, precise = true) {
      const word = m.words.find(w => w.end > position) || m.words.at(-1);
      const block = m.blocks.find(b => position >= b.start && position < b.end);
      if (follow && block && lastPdfBlock !== block.start && document.getElementById('reading')?.hidden && !sourceRange(position, end ?? word.end)) {
        lastPdfBlock = block.start;
        document.dispatchEvent(new CustomEvent('distill-pdf-source', { detail: { text: globalThis.distillPdfResolve?.(m.text.slice(block.start, block.end)) ? m.text.slice(block.start, block.end) : (sentences.find(c => c.start <= position && c.end > position)?.text || '') } }));
      }
      const r = sourceRange(position, end ?? word.end);
      globalThis.CSS?.highlights?.delete('distill-word'); globalThis.CSS?.highlights?.delete('distill-sentence');
      if (r && globalThis.Highlight) {
        CSS.highlights.set(precise ? 'distill-word' : 'distill-sentence', new Highlight(r));
        const rect = r.getBoundingClientRect();
        if (follow && (rect.top < 90 || rect.bottom > innerHeight - host.offsetHeight - 28)) {
          window.scrollBy({ top: rect.top - innerHeight * 0.35, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }
      } else if (document.getElementById('reading')?.hidden) {
        status('PDF alignment unavailable here. Use Show Reading view for precise tracking.');
      }
      $('progress').value = position / m.text.length * 100;
      save();
      document.dispatchEvent(new CustomEvent('distill-reading-position', { detail: { position, text: m.text.slice(position, end || word.end), element: elements[m.blocks.findIndex(b => position >= b.start && position < b.end)] } }));
    }
    function pause() {
      token.next(); clearTimeout(timer); playing = false;
      if (speaking) synth?.cancel(); speaking = false;
      $('play').textContent = 'Play'; save();
    }
    let returnAnchor = null;
    let pendingSourceFocus = null;
    function focusSource(offset) {
      const r=sourceRange(offset,offset+1);
      const target=r?.startContainer.parentElement;
      if(!target){pendingSourceFocus=offset;return false;}
      target.scrollIntoView({block:'center',behavior:'instant'});
      target.setAttribute('tabindex','-1');target.focus({preventScroll:true});pendingSourceFocus=null;return true;
    }
    document.addEventListener('distill-pdf-rendered',()=>{if(pendingSourceFocus!==null)focusSource(pendingSourceFocus);});
    const sourceVersion = globalThis.DistillSourceReturn?.distillSourceVersion(m.text);
    function currentView() { return document.getElementById('reading') ? (document.getElementById('reading').hidden ? 'pdf' : 'reading') : 'html'; }
    function offsetForRange(range) {
      const i = elements.findIndex(el => el.contains(range.startContainer));
      if (i < 0) return null;
      const prefix = document.createRange(); prefix.selectNodeContents(elements[i]); prefix.setEnd(range.startContainer, range.startOffset);
      return {blockIndex:i,charOffset:m.blocks[i].start + prefix.toString().length};
    }
    async function captureReturn() {
      pause(); follow = false;
      if (!sourceVersion || elements.map(el=>el.textContent).join('\n\n') !== m.text) { returnAnchor = null; return null; }
      const view = currentView();
      const base = {schemaVersion:1,paperKey:key,sourceVersion:await sourceVersion,view,focusTarget:'ask-source'};
      let found = null;
      const selection = getSelection();
      if (selection?.rangeCount && !selection.isCollapsed) {
        const range = selection.getRangeAt(0), rect = range.getBoundingClientRect();
        if (rect.height && rect.bottom > 0 && rect.top < innerHeight) {
          found = offsetForRange(range);
          if (!found && view === 'pdf') { const aligned = core.align(m.text,selection.toString()); if (aligned) found = {charOffset:aligned.start,blockIndex:m.blocks.findIndex(b=>aligned.start>=b.start&&aligned.start<b.end)}; }
        }
      }
      const y = innerHeight * 0.35;
      if (!found && view !== 'pdf') {
        const visible = elements.map((el,i)=>({el,i,r:el.getBoundingClientRect()})).filter(x=>x.r.bottom>0&&x.r.top<innerHeight);
        const nearest = visible.sort((a,b)=>Math.abs(Math.max(a.r.top,Math.min(y,a.r.bottom))-y)-Math.abs(Math.max(b.r.top,Math.min(y,b.r.bottom))-y))[0];
        if (nearest) {
          const r = nearest.r;
          const caret = document.caretRangeFromPoint?.(Math.max(1,r.left+4),Math.max(r.top+1,Math.min(y,r.bottom-1)));
          found = caret && offsetForRange(caret);
          if (!found) found={blockIndex:nearest.i,charOffset:m.blocks[nearest.i].start};
        }
      }
      let fallback = null;
      if (!found && view === 'pdf') {
        const slots=[...document.querySelectorAll('#pages .page')].map(el=>({el,r:el.getBoundingClientRect()})).filter(x=>x.r.bottom>0&&x.r.top<innerHeight);
        const slot=slots.sort((a,b)=>Math.abs(a.r.top-y)-Math.abs(b.r.top-y))[0];
        if (slot) {
          const spans=[...slot.el.querySelectorAll('.textLayer span')].filter(el=>el.textContent.trim().length>25);
          const span=spans.sort((a,b)=>Math.abs(a.getBoundingClientRect().top-y)-Math.abs(b.getBoundingClientRect().top-y))[0];
          const aligned=span&&core.align(m.text,span.textContent);
          if (aligned) found={charOffset:aligned.start,blockIndex:m.blocks.findIndex(b=>aligned.start>=b.start&&aligned.start<b.end)};
          fallback={paperKey:key,sourceVersion:base.sourceVersion,page:Number(slot.el.dataset.page),relativeY:-slot.r.top};
        }
      }
      if (!found && !fallback) {returnAnchor=null;return null;}
      returnAnchor={canonical:found ? {...base,...found} : null,pdf:fallback,playback:position};
      return returnAnchor.canonical || fallback;
    }
    async function returnToReading() {
      const saved=returnAnchor;
      if (!saved || elements.map(el=>el.textContent).join('\n\n')!==m.text) {returnAnchor=null;return false;}
      const version=await sourceVersion;
      pause();follow=false;
      if (saved.canonical) {
        const anchor=saved.canonical;
        if (!globalThis.DistillSourceReturn.distillValidSourceReturn(anchor,{paperKey:key,sourceVersion:version,textLength:m.text.length})) return false;
        if (anchor.view !== currentView()) document.dispatchEvent(new CustomEvent(anchor.view==='pdf'?'distill-show-pdf':'distill-show-reading'));
        if (anchor.view==='pdf') document.dispatchEvent(new CustomEvent('distill-pdf-source',{detail:{text:m.text.slice(m.blocks[anchor.blockIndex].start,m.blocks[anchor.blockIndex].end)}}));
        const range=sourceRange(anchor.charOffset,Math.min(anchor.charOffset+1,m.blocks[anchor.blockIndex].end));
        const target=range?.startContainer.parentElement || (anchor.view!=='pdf' ? elements[anchor.blockIndex] : null);
        if (target) {target.scrollIntoView({block:'center',behavior:'instant'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
        else if(anchor.view==='pdf') status('Returning to the saved PDF page. Use Reading view if text alignment is unavailable.');
      } else {
        if(currentView()!=='pdf'||saved.pdf.paperKey!==key||saved.pdf.sourceVersion!==version)return false;
        const page=document.querySelector(`#pages [data-page="${saved.pdf.page}"]`);
        if(!page)return false;
        window.scrollTo({top:scrollY+page.getBoundingClientRect().top+saved.pdf.relativeY,behavior:'instant'});
      }
      position=saved.playback;$('progress').value=position/m.text.length*100;restoreTouched=true;save();returnAnchor=null;
      CSS?.highlights?.delete('distill-word');CSS?.highlights?.delete('distill-sentence');
      status('Returned to your reading place. Playback remains paused.');return true;
    }
    globalThis.distillReadingNavigation = {
      capture:captureReturn, returnToReading, playbackPosition:()=>position,
      jump:async text=>{
        const aligned=core.align(m.text,text);
        if(!aligned)return false;
        if(!await captureReturn())return false;
        if(currentView()==='pdf' && !globalThis.distillPdfResolve?.(text))document.dispatchEvent(new CustomEvent('distill-show-reading'));
        seek(aligned.start);
        if(currentView()==='pdf')document.dispatchEvent(new CustomEvent('distill-pdf-source',{detail:{text}}));
        focusSource(aligned.start);
        return true;
      }
    };
    function play() {
      restoreTouched = true;
      pause();
      const voiceMode = $('mode').value === 'voice';
      const voice = selectedVoice();
      if (voiceMode && !core.route(voice, online && !voice?.localService)) return status('Choose an available voice. Local narration never falls back online.');
      playing = true; $('play').textContent = 'Pause';
      const generation = token.next();
      const tick = () => {
        if (!token.valid(generation) || !playing) return;
        if (position >= m.text.length) { pause(); status('Finished.'); return; }
        if (!voiceMode) {
          const w = m.words.find(w => w.end > position);
          if (!w) { pause(); return; }
          position = w.start; paint(w.end);
          timer = setTimeout(() => { position = w.end; tick(); }, 60000 / Math.min(600, Math.max(60, Number($('pace').value) || 220)));
          return;
        }
        // Recheck routing immediately before every chunk. A removed voice cannot pick a browser default.
        if (!synth.getVoices().includes(voice) && !synth.getVoices().some(v => v.voiceURI === voice.voiceURI && v.localService === voice.localService)) { pause(); status('Voice unavailable. Refresh voices and choose another.'); return; }
        const chunk = sentences.find(c => c.end > position);
        const start = Math.max(chunk.start, position);
        const u = new SpeechSynthesisUtterance(m.text.slice(start, chunk.end));
        u.voice = voice; u.rate = Math.min(2, Math.max(0.5, Number($('rate').value) || 1));
        speaking = true;
        status(voice.localService ? 'Local narration · sentence highlighting until word events arrive.' : `Online narration · ${voice.name} receives this passage.`);
        paint(chunk.end, false);
        u.onboundary = e => {
          if (!token.valid(generation) || e.name !== 'word' || e.charIndex < 0) return;
          position = start + e.charIndex;
          status('Narration · word boundaries from the voice engine.'); paint();
        };
        u.onend = () => { if (!token.valid(generation)) return; speaking = false; position = chunk.end; tick(); };
        u.onerror = e => { if (!token.valid(generation)) return; pause(); status(`Voice stopped (${e.error}). Refresh voices or use silent reading.`); };
        synth.speak(u);
      };
      tick();
    }
    const seek = offset => { const resume = playing; pause(); position = Math.min(m.text.length - 1, Math.max(0, offset)); restoreTouched = true; paint(); if (resume) play(); };
    $('play').onclick = () => playing ? pause() : play();
    $('stop').onclick = () => { pause(); status('Stopped. Position saved.'); };
    $('prev').onclick = () => seek([...sentences].reverse().find(c => c.start < position - 1)?.start || 0);
    $('next').onclick = () => seek(sentences.find(c => c.start > position)?.start ?? m.text.length - 1);
    $('follow').onclick = () => { follow = true; paint(); status('Following reading position.'); };
    $('mode').onchange = () => { pause(); const voice = $('mode').value === 'voice'; $('voiceControls').hidden = !voice; $('rateLabel').hidden = !voice; $('paceLabel').hidden = voice; };
    $('pace').onchange = save; $('rate').onchange = () => { save(); if (playing) play(); };
    $('voice').onchange = () => { pause(); save(); if (!selectedVoice()?.localService) status('Online selected: spoken passages will be transmitted to ' + selectedVoice()?.name + '.'); };
    $('online').onchange = () => { pause(); online = $('online').checked; voices(); };
    $('refresh').onclick = voices;
    $('preview').onclick = () => {
      pause(); const v = selectedVoice(); if (!core.route(v, online)) return status('Choose an available voice.');
      const u = new SpeechSynthesisUtterance('Distill reads the original paper text.'); u.voice = v; u.rate = Number($('rate').value) || 1; speaking = true; const previewGeneration = token.next(); u.onend = () => { if (token.valid(previewGeneration)) speaking = false; }; synth.speak(u);
    };
    function fromSelection() {
      const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return status('Select a passage in the paper first.');
      const r = selection.getRangeAt(0);
      const index = elements.findIndex(el => el.contains(r.startContainer));
      if (index >= 0) { const prefix = document.createRange(); prefix.selectNodeContents(elements[index]); prefix.setEnd(r.startContainer, r.startOffset); seek(m.blocks[index].start + prefix.toString().length); }
      else {
        const a = core.align(m.text, selection.toString());
        if (!a) return status('Selection cannot be uniquely matched. Choose a longer passage or use Reading view.');
        seek(a.start);
      }
    }
    document.addEventListener('distill-source-position', event => {
      const index = elements.findIndex(el => el === event.detail.element || el.contains(event.detail.element));
      if (index >= 0) seek(m.blocks[index].start);
    });
    $('selection').onmousedown = e => e.preventDefault(); $('selection').onclick = fromSelection;
    document.addEventListener('click', e => { if (e.altKey && !e.composedPath().includes(host)) { const range = document.caretRangeFromPoint(e.clientX, e.clientY); if (range) { const s = getSelection(); s.removeAllRanges(); range.setEnd(range.startContainer, Math.min(range.startOffset + 1, range.startContainer.textContent.length)); s.addRange(range); fromSelection(); } } });
    $('source').onclick = () => { document.dispatchEvent(new CustomEvent('distill-show-reading')); follow = true; requestAnimationFrame(() => paint()); };
    const manual = () => { follow = false; status('Following paused while you browse. Resume following when ready.'); };
    window.addEventListener('wheel', manual, { passive: true }); window.addEventListener('touchmove', manual, { passive: true });
    window.addEventListener('keydown', e => { if (['PageUp','PageDown','Home','End','ArrowDown','ArrowUp'].includes(e.key) && !e.composedPath().includes(host)) manual(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); status('Paused when leaving this tab. Press Play to resume.'); } });
    window.addEventListener('pagehide', () => { pause(); clearTimeout(saveTimer); persist(); });
    document.addEventListener('distill-reader-view', () => { lastPdfBlock = -1; requestAnimationFrame(() => paint()); });
    document.addEventListener('distill-pdf-rendered', () => { if (document.getElementById('reading')?.hidden) paint(); });
    synth?.addEventListener('voiceschanged', voices); voices();
    try {
      const saved = (await chrome.storage.local.get(storageKey))[storageKey];
      if (saved && !restoreTouched) {
        if (saved.length === m.text.length && saved.sample === m.text.slice(0, 120)) position = Math.max(0, Math.min(m.text.length - 1, saved.position || 0));
        if (saved.wpm >= 60 && saved.wpm <= 600) $('pace').value = saved.wpm;
        if (saved.rate >= 0.5 && saved.rate <= 2) $('rate').value = saved.rate;
        if ([...$('voice').options].some(o => o.value === saved.voice)) $('voice').value = saved.voice;
        follow = false; paint(); status('Position restored. Play or Resume following when ready.');
      }
    } catch { status('Storage unavailable; reading works for this tab.'); }
  };
})();
