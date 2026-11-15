import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: scormPlayerHtml, SCORM 1.2 player, LMS API,
 *   cmi.core.lesson_status, cmi.core.score.raw, cmi.suspend_data, single SCO
 *
 * WHAT:  The static index.html of a SCORM package: a course player (section
 *        and lecture list, video with captions, notes, interactive quizzes,
 *        final assessment, project brief, resources) that reads
 *        course-data.js and reports to the LMS through the SCORM 1.2 API.
 * WHY:   One SCO is what every LMS imports reliably. Progress lives in
 *        cmi.suspend_data (lecture indexes, not ids, to stay far under the
 *        4096 character limit) and the current item in lesson_location, so
 *        learners resume where they left off. Status: "passed"/"failed" from
 *        the final assessment score against SCORM_MASTERY_SCORE when there is
 *        a graded assessment, otherwise "completed" when every lecture is
 *        done. Opened outside an LMS it runs in preview mode with
 *        localStorage. All model-written text is set with textContent; only
 *        notes and project HTML (escaped server side) use innerHTML.
 *        The script is a plain string with no template interpolation so the
 *        shipped JavaScript is exactly what is written here.
 * WHERE: src/lib/render/scorm-package.ts.
 */

import { PRINT_THEME as T } from '@/lib/config/print-theme'
import { escapeHtml, LESSON_FIGURE_CSS } from './html'

const PLAYER_CSS = `
  ${LESSON_FIGURE_CSS}
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { font-family: ${T.fontSans}; color: ${T.ink}; background: ${T.paper}; font-size: 15px; line-height: 1.6; }
  .app { display: grid; grid-template-columns: 300px 1fr; height: 100vh; }
  aside { border-right: 1px solid ${T.rule}; overflow-y: auto; background: ${T.panel}; }
  .brand { padding: 18px 18px 14px; border-bottom: 1px solid ${T.rule}; }
  .brand h1 { font-size: 16px; margin: 0 0 8px; line-height: 1.3; }
  .bar { height: 6px; background: ${T.rule}; border-radius: 99px; overflow: hidden; }
  .bar > div { height: 100%; background: ${T.accent}; transition: width .3s; }
  .progress-label { font-size: 12px; color: ${T.muted}; margin-top: 6px; }
  .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: ${T.muted}; padding: 14px 18px 6px; }
  nav button { display: flex; gap: 10px; width: 100%; text-align: left; border: 0; background: none; padding: 9px 18px; font: inherit; font-size: 14px; color: inherit; cursor: pointer; }
  nav button:hover { background: ${T.rule}; }
  nav button.active { background: ${T.accentSoft}; font-weight: 600; }
  nav .tick { width: 16px; flex-shrink: 0; color: ${T.success}; }
  main { overflow-y: auto; }
  .content { max-width: 860px; margin: 0 auto; padding: 32px 28px 64px; }
  .kicker { color: ${T.accent}; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
  h2 { font-size: 26px; margin: 0 0 6px; line-height: 1.25; }
  h3 { font-size: 18px; margin: 28px 0 10px; }
  h4 { font-size: 15px; margin: 18px 0 6px; }
  .muted { color: ${T.muted}; }
  video { width: 100%; border-radius: 10px; background: ${T.videoBackdrop}; margin: 14px 0; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
  .btn { border: 1px solid ${T.rule}; background: ${T.paper}; border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 14px; cursor: pointer; }
  .btn.primary { background: ${T.accent}; border-color: ${T.accent}; color: ${T.onAccent}; }
  .btn:disabled { opacity: .5; cursor: default; }
  .done { color: ${T.success}; font-weight: 600; font-size: 14px; }
  .box { background: ${T.panel}; border: 1px solid ${T.rule}; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
  .box > h4:first-child { margin-top: 0; }
  .box.accent { background: ${T.accentSoft}; border-color: ${T.accentSoft}; }
  .label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: ${T.muted}; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  th, td { text-align: left; vertical-align: top; padding: 7px 9px; border-bottom: 1px solid ${T.rule}; }
  th { font-size: 12px; text-transform: uppercase; color: ${T.muted}; }
  code { font-family: ${T.fontMono}; font-size: 13px; background: ${T.panel}; padding: 0 4px; border-radius: 4px; }
  pre.shiki { font-family: ${T.fontMono}; font-size: 13px; padding: 12px 14px; border-radius: 8px; border: 1px solid ${T.rule}; overflow-x: auto; }
  pre.shiki code { background: none; padding: 0; }
  .question { border: 1px solid ${T.rule}; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
  .question .stem { font-weight: 600; margin-bottom: 8px; }
  .option { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
  .option.correct { background: ${T.successSoft}; color: ${T.success}; font-weight: 600; }
  .option.wrong { background: ${T.dangerSoft}; color: ${T.danger}; }
  .explain { margin-top: 8px; font-size: 14px; color: ${T.muted}; }
  .score { font-weight: 600; font-size: 16px; }
  .score.pass { color: ${T.success}; }
  .score.fail { color: ${T.danger}; }
  details summary { cursor: pointer; font-size: 14px; font-weight: 600; }
  .resource { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid ${T.rule}; }
  .menu { display: none; }
  @media (max-width: 860px) {
    .app { grid-template-columns: 1fr; }
    aside { display: none; }
    aside.open { display: block; position: fixed; inset: 0; z-index: 10; }
    .menu { display: inline-block; margin-bottom: 12px; }
  }
`

const PLAYER_JS = String.raw`
(function () {
  'use strict';
  var C = window.COURSE_DATA;

  /* ── SCORM 1.2 API discovery and wrapper ── */
  function findAPI(win) {
    var tries = 0;
    while (win && !win.API && win.parent && win.parent !== win && tries < 12) { win = win.parent; tries += 1; }
    return win && win.API ? win.API : null;
  }
  var api = null;
  try { api = findAPI(window) || (window.opener ? findAPI(window.opener) : null); } catch (e) { api = null; }
  var lms = {
    connected: false,
    init: function () { if (api && String(api.LMSInitialize('')) === 'true') this.connected = true; },
    get: function (key) { return this.connected ? String(api.LMSGetValue(key) || '') : ''; },
    set: function (key, value) { if (this.connected) api.LMSSetValue(key, String(value)); },
    commit: function () { if (this.connected) api.LMSCommit(''); },
    finish: function () { if (this.connected) { api.LMSFinish(''); this.connected = false; } }
  };
  var PREVIEW_KEY = 'scorm-preview:' + C.title;
  function local(op, value) {
    try { if (op === 'get') return window.localStorage.getItem(PREVIEW_KEY); window.localStorage.setItem(PREVIEW_KEY, value); } catch (e) { return null; }
    return null;
  }

  /* ── Course structure ── */
  var items = [];
  var lectureCount = 0;
  C.sections.forEach(function (section, s) {
    section.lectures.forEach(function (lecture, l) {
      items.push({ kind: 'lecture', s: s, l: l, g: lectureCount, title: lecture.title });
      lectureCount += 1;
    });
    if (section.quiz.length) items.push({ kind: 'quiz', s: s, title: 'Section quiz' });
  });
  if (C.finalAssessment.length) items.push({ kind: 'final', title: 'Final assessment' });
  if (C.projectHtml) items.push({ kind: 'project', title: 'Final project' });
  if (C.resources.length) items.push({ kind: 'resources', title: 'Resources' });

  var GRADED = { MULTIPLE_CHOICE: 1, SCENARIO: 1, MULTIPLE_RESPONSE: 1, TRUE_FALSE: 1 };
  var finalGraded = C.finalAssessment.filter(function (q) { return GRADED[q.type]; }).length > 0;

  /* ── State: d = done lecture indexes, f = final score ── */
  var state = { d: [], f: null };
  var current = 0;
  var startedAt = Date.now();

  function load() {
    var raw = lms.connected ? lms.get('cmi.suspend_data') : local('get');
    try {
      var parsed = JSON.parse(raw || '');
      if (parsed && Array.isArray(parsed.d)) state = { d: parsed.d, f: typeof parsed.f === 'number' ? parsed.f : null };
    } catch (e) { /* fresh start */ }
    var location = parseInt(lms.connected ? lms.get('cmi.core.lesson_location') : '', 10);
    if (!isNaN(location) && location >= 0 && location < items.length) current = location;
  }

  function report() {
    var allDone = state.d.length >= lectureCount;
    var status = 'incomplete';
    if (finalGraded && state.f !== null) status = state.f >= C.masteryScore ? 'passed' : 'failed';
    else if (!finalGraded && allDone) status = 'completed';
    lms.set('cmi.core.lesson_status', status);
    if (state.f !== null) {
      lms.set('cmi.core.score.min', 0);
      lms.set('cmi.core.score.max', 100);
      lms.set('cmi.core.score.raw', state.f);
    }
  }

  function save() {
    var raw = JSON.stringify(state);
    if (lms.connected) {
      lms.set('cmi.suspend_data', raw);
      lms.set('cmi.core.lesson_location', current);
      report();
      lms.commit();
    } else {
      local('set', raw);
    }
  }

  function sessionTime() {
    var total = Math.round((Date.now() - startedAt) / 1000);
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    function pad(n, w) { var t = String(n); while (t.length < w) t = '0' + t; return t; }
    return pad(h, 4) + ':' + pad(m, 2) + ':' + pad(s, 2);
  }

  /* ── DOM helpers (text only through textContent) ── */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'onclick') node.addEventListener('click', attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  /* ── Quiz ── */
  function renderQuiz(questions, onScored) {
    var wrap = el('div');
    var blocks = questions.map(function (q, i) {
      var block = el('div', { class: 'question' });
      var name = 'q' + Math.random().toString(36).slice(2) + i;
      var stemText = q.question || q.statement || q.text || q.prompt || '';
      if (q.type === 'SCENARIO') block.appendChild(el('p', { text: q.scenario }));
      block.appendChild(el('div', { class: 'stem', text: (i + 1) + '. ' + stemText }));
      var inputs = [];
      function option(label, value, type) {
        var input = el('input', { type: type, name: name, value: value });
        var row = el('label', { class: 'option' }, [input, el('span', { text: label })]);
        inputs.push({ input: input, row: row, value: value });
        block.appendChild(row);
      }
      if (q.type === 'MULTIPLE_CHOICE' || q.type === 'SCENARIO') q.options.forEach(function (o) { option(o.text, o.id, 'radio'); });
      else if (q.type === 'MULTIPLE_RESPONSE') {
        block.appendChild(el('p', { class: 'muted', text: 'Select all that apply.' }));
        q.options.forEach(function (o) { option(o.text, o.id, 'checkbox'); });
      } else if (q.type === 'TRUE_FALSE') { option('True', 'true', 'radio'); option('False', 'false', 'radio'); }
      else {
        var answer = el('div', { class: 'explain' });
        if (q.type === 'SHORT_ANSWER') {
          answer.appendChild(el('p', { text: q.sampleAnswer }));
          answer.appendChild(el('ul', {}, q.rubric.map(function (r) { return el('li', { text: r }); })));
        } else if (q.type === 'FILL_BLANK') answer.appendChild(el('p', { text: 'Answers: ' + q.answers.join(', ') }));
        else if (q.type === 'MATCHING') answer.appendChild(el('ul', {}, q.pairs.map(function (p) { return el('li', { text: p.left + ' → ' + p.right }); })));
        answer.appendChild(el('p', { text: q.explanation }));
        block.appendChild(el('details', {}, [el('summary', { text: 'Show answer' }), answer]));
      }
      var explain = el('div', { class: 'explain', hidden: 'hidden', text: q.explanation });
      block.appendChild(explain);
      wrap.appendChild(block);
      return { q: q, inputs: inputs, explain: explain };
    });

    var result = el('div', { class: 'score' });
    var graded = blocks.filter(function (b) { return GRADED[b.q.type]; });
    if (graded.length) {
      wrap.appendChild(el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: 'Check answers', onclick: function () {
          var correct = 0;
          graded.forEach(function (b) {
            var q = b.q;
            var right = q.type === 'TRUE_FALSE' ? [String(q.answer)] : q.type === 'MULTIPLE_RESPONSE' ? q.correctOptionIds : [q.correctOptionId];
            var picked = b.inputs.filter(function (x) { return x.input.checked; }).map(function (x) { return x.value; });
            var ok = picked.length === right.length && picked.every(function (v) { return right.indexOf(v) !== -1; });
            if (ok) correct += 1;
            b.inputs.forEach(function (x) {
              x.row.classList.remove('correct', 'wrong');
              if (right.indexOf(x.value) !== -1) x.row.classList.add('correct');
              else if (x.input.checked) x.row.classList.add('wrong');
            });
            b.explain.hidden = false;
          });
          var percent = Math.round((correct / graded.length) * 100);
          result.textContent = correct + ' of ' + graded.length + ' correct (' + percent + '%)';
          if (onScored) onScored(percent, result);
        } }),
        result
      ]));
    }
    return wrap;
  }

  /* ── Views ── */
  var nav = document.getElementById('nav');
  var main = document.getElementById('content');
  var bar = document.getElementById('bar');
  var progressLabel = document.getElementById('progress-label');

  function markDone(g) {
    if (state.d.indexOf(g) === -1) { state.d.push(g); save(); }
    renderNav();
  }

  function navButtons() {
    var row = el('div', { class: 'row' });
    row.appendChild(el('button', { class: 'btn', text: '← Previous', onclick: function () { go(current - 1); } }));
    row.appendChild(el('button', { class: 'btn', text: 'Next →', onclick: function () { go(current + 1); } }));
    row.firstChild.disabled = current === 0;
    row.lastChild.disabled = current === items.length - 1;
    return row;
  }

  function renderItem() {
    var item = items[current];
    main.innerHTML = '';
    main.appendChild(el('button', { class: 'btn menu', text: 'Course content', onclick: function () { document.querySelector('aside').classList.add('open'); } }));
    if (item.kind === 'lecture') {
      var section = C.sections[item.s];
      var lecture = section.lectures[item.l];
      main.appendChild(el('div', { class: 'kicker', text: 'Section ' + (item.s + 1) + ' · ' + section.title }));
      main.appendChild(el('h2', { text: lecture.title }));
      main.appendChild(el('div', { class: 'muted', text: lecture.minutes + ' min' }));
      if (lecture.video) {
        var video = el('video', { controls: 'controls', preload: 'metadata', src: lecture.video });
        if (lecture.captions) video.appendChild(el('track', { kind: 'captions', label: 'Captions', src: lecture.captions, default: 'default' }));
        video.addEventListener('ended', function () { markDone(item.g); renderItem(); });
        main.appendChild(video);
      }
      var doneRow = el('div', { class: 'row' });
      if (state.d.indexOf(item.g) !== -1) doneRow.appendChild(el('span', { class: 'done', text: '✓ Completed' }));
      else doneRow.appendChild(el('button', { class: 'btn primary', text: 'Mark as complete', onclick: function () { markDone(item.g); renderItem(); } }));
      main.appendChild(doneRow);
      if (lecture.notesHtml) { main.appendChild(el('h3', { text: 'Lecture notes' })); main.appendChild(el('div', { html: lecture.notesHtml })); }
      if (lecture.quiz.length) { main.appendChild(el('h3', { text: 'Quiz' })); main.appendChild(renderQuiz(lecture.quiz)); }
    } else if (item.kind === 'quiz') {
      main.appendChild(el('div', { class: 'kicker', text: 'Section ' + (item.s + 1) + ' · ' + C.sections[item.s].title }));
      main.appendChild(el('h2', { text: 'Section quiz' }));
      main.appendChild(renderQuiz(C.sections[item.s].quiz));
    } else if (item.kind === 'final') {
      main.appendChild(el('h2', { text: 'Final assessment' }));
      if (finalGraded) main.appendChild(el('p', { class: 'muted', text: 'Score ' + C.masteryScore + '% or more to pass.' + (state.f !== null ? ' Your best recorded score: ' + state.f + '%.' : '') }));
      main.appendChild(renderQuiz(C.finalAssessment, function (percent, result) {
        state.f = state.f === null ? percent : Math.max(state.f, percent);
        result.classList.remove('pass', 'fail');
        result.classList.add(percent >= C.masteryScore ? 'pass' : 'fail');
        result.textContent += percent >= C.masteryScore ? ' · Passed' : ' · Not passed yet';
        save();
      }));
    } else if (item.kind === 'project') {
      main.appendChild(el('div', { html: C.projectHtml }));
    } else {
      main.appendChild(el('h2', { text: 'Resources' }));
      C.resources.forEach(function (r) {
        main.appendChild(el('div', { class: 'resource' }, [el('span', { text: r.title }), el('a', { class: 'btn', href: r.file, download: '', text: 'Download' })]));
      });
    }
    main.appendChild(navButtons());
    document.querySelector('main').scrollTop = 0;
  }

  function renderNav() {
    nav.innerHTML = '';
    var lastSection = -1;
    items.forEach(function (item, i) {
      if (item.s !== undefined && item.s !== lastSection) {
        lastSection = item.s;
        nav.appendChild(el('div', { class: 'section-title', text: 'Section ' + (item.s + 1) + ': ' + C.sections[item.s].title }));
      } else if (item.s === undefined && lastSection !== -2) {
        lastSection = -2;
        nav.appendChild(el('div', { class: 'section-title', text: 'Wrap up' }));
      }
      var done = item.kind === 'lecture' && state.d.indexOf(item.g) !== -1;
      var button = el('button', { class: i === current ? 'active' : '', onclick: function () { go(i); } }, [
        el('span', { class: 'tick', text: done ? '✓' : '' }),
        el('span', { text: item.title })
      ]);
      nav.appendChild(button);
    });
    var percent = lectureCount ? Math.round((state.d.length / lectureCount) * 100) : 0;
    bar.style.width = percent + '%';
    progressLabel.textContent = state.d.length + ' of ' + lectureCount + ' lectures complete · ' + percent + '%';
  }

  function go(i) {
    if (i < 0 || i >= items.length) return;
    current = i;
    document.querySelector('aside').classList.remove('open');
    if (lms.connected) { lms.set('cmi.core.lesson_location', current); lms.commit(); }
    renderNav();
    renderItem();
  }

  /* ── Start ── */
  lms.init();
  if (lms.connected && lms.get('cmi.core.lesson_status') === 'not attempted') lms.set('cmi.core.lesson_status', 'incomplete');
  load();
  document.getElementById('mode').textContent = lms.connected ? '' : 'Preview mode: progress is saved in this browser only.';
  renderNav();
  renderItem();
  function exit() {
    if (!lms.connected) return;
    save();
    lms.set('cmi.core.session_time', sessionTime());
    lms.set('cmi.core.exit', state.d.length >= lectureCount ? '' : 'suspend');
    lms.commit();
    lms.finish();
  }
  window.addEventListener('pagehide', exit);
  window.addEventListener('beforeunload', exit);
})();
`

/** index.html of the SCORM package; data comes from course-data.js beside it. */
export function scormPlayerHtml(title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PLAYER_CSS}</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand">
      <h1>${escapeHtml(title)}</h1>
      <div class="bar"><div id="bar" style="width:0%"></div></div>
      <div class="progress-label" id="progress-label"></div>
      <div class="progress-label" id="mode"></div>
    </div>
    <nav id="nav"></nav>
  </aside>
  <main><div class="content" id="content"></div></main>
</div>
<script src="course-data.js"></script>
<script>${PLAYER_JS}</script>
</body>
</html>
`
}
