(function(){
  function createExpressionSchemeRuntime(opts){
    const {
      SIZE,
      canvas,
      ctx,
      screenWrap,
      emotionLabelEl,
      textEl,
      chipsEl,
      schemeInfoEl,
      footerTextEl,
      footerHintEl,
      makeMatrix,
      clamp,
      _setPx,
      setPx,
      drawLine,
      drawCircle,
      fillCircle,
      drawArc,
      drawThick,
      centerPatternVertically,
      hexToRgba
    } = opts;

    const STORAGE_KEY = 'robot-led-face-expression-scheme';

    function normText(s){
      return (s || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\r\t]+/g, ' ')
        .trim();
    }

    function scoreWithRules(text, rules, hooks){
      const t = normText(text);
      const low = t.toLowerCase();
      const scores = {};
      Object.keys(rules).forEach((key)=>{ scores[key] = 0; });

      const meta = {
        exclaim: (t.match(/!/g) || []).length + (t.match(/！/g) || []).length,
        ques: (t.match(/\?/g) || []).length + (t.match(/？/g) || []).length,
        ellipsis: (t.match(/…/g) || []).length + (t.match(/\.\.\./g) || []).length
      };

      if(hooks && typeof hooks.before === 'function') hooks.before(scores, t, low, meta);

      for(const [id, rule] of Object.entries(rules)){
        for(const kw of rule.kws || []){
          if(!kw) continue;
          const needle = kw.toLowerCase();
          if(low.includes(needle) || t.includes(kw)){
            const boost = Math.min(1.85, 0.72 + needle.length * 0.08);
            scores[id] += boost * (rule.w || 1);
          }
        }
        for(const re of rule.re || []){
          if(re.test(t) || re.test(low)) scores[id] += 1.25 * (rule.w || 1);
        }
      }

      if(hooks && typeof hooks.after === 'function') hooks.after(scores, t, low, meta);
      return { scores, meta, text: t, low };
    }

    function pickBestEmotion(scores, fallbackId){
      let bestId = fallbackId;
      let best = -Infinity;
      for(const [id, val] of Object.entries(scores)){
        if(val > best){
          best = val;
          bestId = id;
        }
      }
      if(best <= 0.01) bestId = fallbackId;
      return { bestId, scores };
    }

    function shiftMatrix(matrix, shiftY){
      if(!matrix || shiftY === 0) return matrix;
      const out = makeMatrix(0);
      for(let y=0; y<SIZE; y++){
        for(let x=0; x<SIZE; x++){
          const v = matrix[y][x];
          if(v > 0.02) _setPx(out, x, y + shiftY, v);
        }
      }
      return out;
    }

    function centerRenderSpec(spec){
      const renderSpec = spec && spec.base ? spec : { base: spec, accents: [] };
      const layers = [renderSpec.base].concat((renderSpec.accents || []).map((accent)=>accent.matrix));
      let minY = SIZE;
      let maxY = -1;

      layers.forEach((matrix)=>{
        if(!matrix) return;
        for(let y=0; y<SIZE; y++){
          for(let x=0; x<SIZE; x++){
            if(matrix[y][x] > 0.02){
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
          }
        }
      });

      if(maxY < 0) return renderSpec;
      const shiftY = Math.round(((SIZE - 1) / 2) - ((minY + maxY) / 2));
      if(shiftY === 0) return renderSpec;

      return {
        base: shiftMatrix(renderSpec.base, shiftY),
        accents: (renderSpec.accents || []).map((accent)=>({
          color: accent.color,
          intensity: accent.intensity,
          matrix: shiftMatrix(accent.matrix, shiftY)
        }))
      };
    }

    function drawLayer(matrix, color, intensityScale){
      if(!matrix) return;
      const W = canvas.width;
      const H = canvas.height;
      const dim = Math.min(W, H);
      const pad = Math.floor(dim * 0.08);
      const cell = (dim - pad * 2) / SIZE;
      const r = cell * 0.45;
      const offX = (W - dim) / 2;
      const offY = (H - dim) / 2;
      const layerScale = (intensityScale === null || intensityScale === undefined) ? 1 : intensityScale;

      for(let y=0; y<SIZE; y++){
        for(let x=0; x<SIZE; x++){
          const v = matrix[y][x];
          if(v <= 0.02) continue;
          const cx = offX + pad + (x + 0.5) * cell;
          const cy = offY + pad + (y + 0.5) * cell;
          const intensity = clamp((v / 2) * layerScale, 0, 1);
          const glowA = 0.10 + 0.55 * intensity;
          const coreA = 0.20 + 0.75 * intensity;

          ctx.save();
          ctx.shadowBlur = r * 3.4;
          ctx.shadowColor = hexToRgba(color, 0.9);
          ctx.fillStyle = hexToRgba(color, glowA);
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.05);
          g.addColorStop(0, hexToRgba('#ffffff', 0.95 * coreA));
          g.addColorStop(0.35, hexToRgba(color, 0.90 * coreA));
          g.addColorStop(1, hexToRgba(color, 0.05));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function drawLED(renderSpec, color){
      const spec = renderSpec && renderSpec.base ? renderSpec : { base: renderSpec, accents: [] };
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#02030a';
      ctx.fillRect(0, 0, W, H);

      const dim = Math.min(W, H);
      const pad = Math.floor(dim * 0.08);
      const cell = (dim - pad * 2) / SIZE;
      const r = cell * 0.45;
      const offX = (W - dim) / 2;
      const offY = (H - dim) / 2;

      for(let y=0; y<SIZE; y++){
        for(let x=0; x<SIZE; x++){
          const cx = offX + pad + (x + 0.5) * cell;
          const cy = offY + pad + (y + 0.5) * cell;
          ctx.beginPath();
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      drawLayer(spec.base, color, 1);
      (spec.accents || []).forEach((accent)=>{
        drawLayer(accent.matrix, accent.color || color, (accent.intensity === null || accent.intensity === undefined) ? 1 : accent.intensity);
      });

      const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, dim * 0.20, W * 0.5, H * 0.5, dim * 0.62);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    function createSchemeOne(){
      const EMOTIONS = [
        { id:'happy', emoji:'😊', label:'快乐/友好', color:'#ffef6a' },
        { id:'sad', emoji:'😢', label:'悲伤/同情', color:'#5ad7ff' },
        { id:'angry', emoji:'😠', label:'愤怒/警告', color:'#ff375f' },
        { id:'fear', emoji:'😨', label:'恐惧/惊讶', color:'#bfa8ff' },
        { id:'disgust', emoji:'🤢', label:'厌恶/拒绝', color:'#8dff7a' },
        { id:'focus', emoji:'👀', label:'专注/倾听', color:'#18f7ff' },
        { id:'think', emoji:'🤔', label:'思考/处理中', color:'#ffb02e' },
        { id:'confirm', emoji:'✅', label:'确认/完成', color:'#6bffb6' },
        { id:'confuse', emoji:'❓', label:'困惑/疑问', color:'#ff8df2' },
        { id:'wink', emoji:'😉', label:'眨眼/调皮', color:'#ff3bf5' },
        { id:'sleepy', emoji:'😴', label:'困倦/低电量', color:'#8aa0ff' },
        { id:'party', emoji:'🎉', label:'庆祝/兴奋', color:'#b6ff4a' }
      ];
      const EMOTION_BY_ID = Object.fromEntries(EMOTIONS.map((item)=>[item.id, item]));
      const FACE = { leftEyeX: 8, rightEyeX: 16, eyeY: 10, browOuterY: 4, browInnerY: 5 };

      function faceBase(){ return makeMatrix(0); }
      function addEyesSmile(m){
        drawThick(m, (mm)=>{
          drawArc(mm, FACE.leftEyeX, FACE.eyeY + 0.2, 1.8, Math.PI * 0.2, Math.PI * 0.8, 2);
          drawArc(mm, FACE.rightEyeX, FACE.eyeY + 0.2, 1.8, Math.PI * 0.2, Math.PI * 0.8, 2);
        }, 0);
      }
      function addEyesRound(m, open){
        const openness = (open === null || open === undefined) ? 1 : open;
        const r = openness > 0.9 ? 1.8 : (openness > 0.55 ? 1.5 : 1.1);
        drawThick(m, (mm)=>{
          drawCircle(mm, FACE.leftEyeX, FACE.eyeY, r, 2);
          drawCircle(mm, FACE.rightEyeX, FACE.eyeY, r, 2);
        }, 0);
        if(openness > 0.75){
          setPx(m, FACE.leftEyeX, FACE.eyeY, 2);
          setPx(m, FACE.rightEyeX, FACE.eyeY, 2);
        }
      }
      function addEyesFocus(m, t){
        const pts = [[0, -1], [0, 0], [1, 0]];
        const idx = Math.floor(t * 0.001) % pts.length;
        const [dx, dy] = pts[idx];
        drawThick(m, (mm)=>{
          drawCircle(mm, FACE.leftEyeX, FACE.eyeY, 1.8, 2);
          drawCircle(mm, FACE.rightEyeX, FACE.eyeY, 1.8, 2);
        }, 0);
        setPx(m, FACE.leftEyeX + dx, FACE.eyeY + dy, 2);
        setPx(m, FACE.rightEyeX + dx, FACE.eyeY + dy, 2);
      }
      function addEyesLine(m, leftY, rightY, tilt, v){
        const lY = (leftY === null || leftY === undefined) ? FACE.eyeY : leftY;
        const rY = (rightY === null || rightY === undefined) ? FACE.eyeY : rightY;
        const tlt = tilt || 0;
        const val = v || 2;
        drawThick(m, (mm)=>{
          drawLine(mm, FACE.leftEyeX - 2, lY - tlt, FACE.leftEyeX + 2, lY + tlt, val);
          drawLine(mm, FACE.rightEyeX - 2, rY + tlt, FACE.rightEyeX + 2, rY - tlt, val);
        }, 0);
      }
      function addBrowsAngry(m){
        drawThick(m, (mm)=>{
          drawLine(mm, 5, FACE.browOuterY, 10, FACE.browInnerY, 2);
          drawLine(mm, 14, FACE.browInnerY, 19, FACE.browOuterY, 2);
        }, 0);
      }
      function addBrowsSad(m){
        drawThick(m, (mm)=>{
          drawLine(mm, 5, FACE.browInnerY, 10, FACE.browOuterY, 2);
          drawLine(mm, 14, FACE.browOuterY, 19, FACE.browInnerY, 2);
        }, 0);
      }
      function addBrowsConfused(m, t){
        const wobble = Math.round(Math.sin(t * 0.0016) * 1);
        drawThick(m, (mm)=>{
          drawLine(mm, 5, FACE.browOuterY + wobble, 10, FACE.browOuterY - 1, 2);
          drawLine(mm, 14, FACE.browOuterY - 1, 19, FACE.browOuterY + wobble, 2);
        }, 0);
      }
      function addMouthSmile(m){
        drawThick(m, (mm)=>{
          drawArc(mm, 12, 16.1, 5.5, Math.PI * 0.20, Math.PI * 0.80, 2);
        }, 0);
      }
      function addMouthFrown(m){
        drawThick(m, (mm)=>{
          drawArc(mm, 12, 20.0, 5.2, Math.PI * 1.20, Math.PI * 1.80, 2);
        }, 0);
      }
      function addMouthFlat(m){
        drawThick(m, (mm)=>{
          drawLine(mm, 9, 17, 15, 17, 2);
        }, 0);
      }
      function addEyesFearSurprised(m){
        fillCircle(m, FACE.leftEyeX, FACE.eyeY + 0.6, 2.6, 2);
        fillCircle(m, FACE.rightEyeX, FACE.eyeY + 0.6, 2.6, 2);
        drawThick(m, (mm)=>{
          drawLine(mm, FACE.leftEyeX - 1.3, FACE.eyeY + 3.0, FACE.leftEyeX, FACE.eyeY + 3.8, 2);
          drawLine(mm, FACE.rightEyeX, FACE.eyeY + 3.8, FACE.rightEyeX + 1.3, FACE.eyeY + 3.0, 2);
        }, 0);
      }
      function addBrowsFearSurprised(m){
        drawThick(m, (mm)=>{
          drawArc(mm, FACE.leftEyeX - 2.3, FACE.eyeY - 6.05, 3.0, Math.PI * 0.13, Math.PI * 0.58, 2);
          drawArc(mm, FACE.rightEyeX + 2.3, FACE.eyeY - 6.05, 3.0, Math.PI * 0.42, Math.PI * 0.87, 2);
        }, 0);
      }
      function addMouthFearSurprised(m){
        drawThick(m, (mm)=>{
          const pts = [
            [5.3, 20.0], [6.3, 18.8], [7.4, 17.9], [8.4, 18.5],
            [9.8, 20.0], [11.1, 19.1], [12.0, 17.6], [13.2, 17.7],
            [14.4, 19.4], [15.5, 20.1], [16.7, 18.3], [17.9, 18.6],
            [18.9, 19.9]
          ];
          for(let i=0; i<pts.length - 1; i++) drawLine(mm, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2);
          drawLine(mm, 5.3, 20.0, 4.5, 21.0, 2);
          drawLine(mm, 18.9, 19.9, 19.7, 21.0, 2);
        }, 0);
      }

      function patternFor(emotionId, t){
        const m = faceBase();
        const blink = (Math.sin(t * 0.0032) + 1) / 2;
        const blinkClosed = blink > 0.84;

        switch(emotionId){
          case 'happy':
            addEyesSmile(m);
            addMouthSmile(m);
            break;
          case 'sad':
            addBrowsSad(m);
            addEyesRound(m, blinkClosed ? 0.45 : 0.82);
            addMouthFrown(m);
            break;
          case 'angry':
            addBrowsAngry(m);
            addEyesLine(m, FACE.eyeY, FACE.eyeY, 0, 2);
            addMouthFlat(m);
            break;
          case 'fear':
            addBrowsFearSurprised(m);
            addEyesFearSurprised(m);
            addMouthFearSurprised(m);
            break;
          case 'disgust':
            drawThick(m, (mm)=>{
              drawLine(mm, 6, FACE.eyeY, 10, FACE.eyeY - 1, 2);
              drawLine(mm, 14, FACE.eyeY - 1, 18, FACE.eyeY, 2);
            }, 0);
            drawThick(m, (mm)=>{
              drawLine(mm, 9, 18, 12, 17, 2);
              drawLine(mm, 12, 17, 15, 18, 2);
            }, 0);
            break;
          case 'focus':
            addEyesFocus(m, t);
            drawThick(m, (mm)=>{
              drawArc(mm, 12, -23, 40, Math.PI * 0.48, Math.PI * 0.52, 2);
            }, 0);
            break;
          case 'think':
            drawThick(m, (mm)=>{
              drawCircle(mm, FACE.leftEyeX, FACE.eyeY, 1.6, 2);
              drawCircle(mm, FACE.rightEyeX, FACE.eyeY, 1.6, 2);
            }, 0);
            setPx(m, FACE.leftEyeX - 1, FACE.eyeY + 1, 2);
            setPx(m, FACE.rightEyeX - 1, FACE.eyeY - 1, 2);
            drawThick(m, (mm)=>{
              drawLine(mm, 5, 6, 10, 6, 2);
              drawLine(mm, 14, 6, 19, 5, 2);
            }, 0);
            drawThick(m, (mm)=>{
              drawLine(mm, 10, 17, 14, 16, 2);
            }, 0);
            break;
          case 'confirm':
            drawThick(m, (mm)=>{
              drawLine(mm, FACE.leftEyeX - 2, FACE.eyeY, FACE.leftEyeX + 2, FACE.eyeY, 2);
              if(!blinkClosed) drawCircle(mm, FACE.rightEyeX, FACE.eyeY, 1.6, 2);
            }, 0);
            if(!blinkClosed) setPx(m, FACE.rightEyeX, FACE.eyeY, 2);
            addMouthSmile(m);
            break;
          case 'confuse':
            addBrowsConfused(m, t);
            drawThick(m, (mm)=>{
              drawCircle(mm, FACE.leftEyeX, FACE.eyeY, blinkClosed ? 1.2 : 1.6, 2);
              drawCircle(mm, FACE.rightEyeX, FACE.eyeY, 1.6, 2);
            }, 0);
            setPx(m, FACE.leftEyeX, FACE.eyeY, 2);
            setPx(m, FACE.rightEyeX, FACE.eyeY, 2);
            drawThick(m, (mm)=>{
              drawLine(mm, 9, 18, 15, 16, 2);
            }, 0);
            break;
          case 'wink':
            drawThick(m, (mm)=>{
              drawCircle(mm, FACE.leftEyeX, FACE.eyeY, 1.6, 2);
              drawLine(mm, FACE.rightEyeX - 2, FACE.eyeY, FACE.rightEyeX + 2, FACE.eyeY, 2);
            }, 0);
            setPx(m, FACE.leftEyeX, FACE.eyeY, 2);
            drawThick(m, (mm)=>{
              drawArc(mm, 11, 16.8, 5.1, Math.PI * 0.10, Math.PI * 0.56, 2);
            }, 0);
            break;
          case 'sleepy':
            addEyesLine(m, FACE.eyeY, FACE.eyeY, 0, 2);
            drawThick(m, (mm)=>{
              drawLine(mm, FACE.leftEyeX - 2, FACE.eyeY + 1, FACE.leftEyeX + 2, FACE.eyeY + 2, 1);
              drawLine(mm, FACE.rightEyeX - 2, FACE.eyeY + 2, FACE.rightEyeX + 2, FACE.eyeY + 1, 1);
            }, 0);
            drawThick(m, (mm)=>{
              drawArc(mm, 12, 18, 3.0, Math.PI * 1.10, Math.PI * 1.90, 2);
            }, 0);
            break;
          case 'party':
            addEyesRound(m, 1);
            drawThick(m, (mm)=>{
              drawArc(mm, 12, 15.7, 6.0, Math.PI * 0.15, Math.PI * 0.85, 2);
            }, 0);
            break;
          default:
            addEyesRound(m, 0.9);
            addMouthSmile(m);
        }

        return centerPatternVertically(m);
      }

      const RULES = {
        happy: { kws:['开心','高兴','快乐','幸福','太棒了','好棒','赞','喜欢','爱了','感动','谢谢','感谢','nice','great','awesome','amazing','love','happy','glad','yay','wonderful','fantastic','🎉','🥳','lol','哈哈','哈哈哈','笑死','笑哭','爽'], re:[/\bcongrats?\b/i, /\bwell\s*done\b/i, /\bthank(s|you)\b/i] },
        sad: { kws:['难过','伤心','沮丧','失落','心碎','哭','流泪','遗憾','抱歉','对不起','同情','可怜','sad','down','depressed','upset','sorry','regret','miss','lonely'], re:[/\bmy\s*bad\b/i, /\bfeel\s*bad\b/i] },
        angry: { kws:['生气','愤怒','火大','气死','烦死','讨厌','警告','别再','滚','离谱','恶心你','angry','mad','furious','annoyed','hate','wtf','damn','shut up'], re:[/!{2,}/, /\bseriously\b/i] },
        fear: { kws:['害怕','恐惧','担心','焦虑','紧张','慌','吓死','惊讶','震惊','不敢','怎么办','scared','afraid','fear','anxious','nervous','worried','panic','shocked','surprised'], re:[/\bomg\b/i, /\bwhat\s*happened\b/i] },
        disgust: { kws:['恶心','反感','厌恶','拒绝','不行','算了吧','别了','受不了','离我远点','gross','disgust','nasty','ew','nope','reject'], re:[/\bno\s*way\b/i] },
        focus: { kws:['我在听','继续说','请讲','我明白你说的','嗯嗯','好的你说','listen','listening','go on','i\'m listening','tell me more','i see'], re:[/\bcarry\s*on\b/i] },
        think: { kws:['让我想想','思考','分析一下','处理中','我需要时间','稍等','我在处理','推理','可能','也许','maybe','let me think','thinking','processing','give me a moment','hold on','consider'], re:[/\bto\s*be\s*honest\b/i] },
        confirm: { kws:['好的','明白','收到','确认','完成','搞定','可以','没问题','已解决','done','ok','okay','sure','confirmed','completed','resolved','got it','roger'], re:[/\blooks\s*good\b/i] },
        confuse: { kws:['不懂','没理解','什么意思','为什么','怎么回事','疑问','困惑','看不懂','??','???','confused','not sure','i don\'t understand','what do you mean','huh','why'], re:[/\?{2,}/] },
        wink: { kws:['开个玩笑','逗你','你懂的','嘿嘿','调皮','wink','just kidding','jk',';)','；）','🤫'], re:[/;\)/] },
        sleepy: { kws:['困了','好困','想睡','疲惫','累','低电量','没电','顶不住','zZ','zzz','sleepy','tired','exhausted','need sleep','low battery','drained'], re:[/\bzzz+\b/i] },
        party: { kws:['庆祝','太好了','激动','兴奋','起飞','冲','赢了','突破','release','上线了','success','party','celebrate','excited','let\'s go','we did it','victory'], re:[/\bship(ped)?\b/i, /\blaunch(ed)?\b/i] }
      };

      const examples = [
        { t:'太棒了！我们上线成功了！🎉', id:'party' },
        { t:'我有点难过…这次没做好。', id:'sad' },
        { t:'别再这样了！！', id:'angry' },
        { t:'I\'m scared… what if it fails?', id:'fear' },
        { t:'这太恶心了，完全不能接受。', id:'disgust' },
        { t:'你继续说，我在听。', id:'focus' },
        { t:'让我想想，可能需要一步步分析。', id:'think' },
        { t:'收到，已确认完成 ✅', id:'confirm' },
        { t:'我不太理解你的意思？？', id:'confuse' },
        { t:'嘿嘿，just kidding ;)', id:'wink' },
        { t:'好困…低电量了。', id:'sleepy' },
        { t:'I\'m so happy, thanks!', id:'happy' }
      ];

      function pickEmotion(text){
        const { scores } = scoreWithRules(text, RULES, {
          after(scoresRef, t, low, meta){
            if(meta.exclaim >= 2){ scoresRef.party += 1.2; scoresRef.angry += 0.6; }
            if(meta.ques >= 2) scoresRef.confuse += 1.2;
            if(meta.ellipsis >= 1){ scoresRef.sad += 0.5; scoresRef.think += 0.35; }
            if(/(谢谢|感谢|thank)/i.test(t)) scoresRef.happy += 0.8;
            if(/(对不起|抱歉|sorry)/i.test(t)) scoresRef.sad += 0.6;
            if(/(不行|拒绝|nope|reject)/i.test(t)) scoresRef.disgust += 0.6;
            if(/(我在听|listen|listening)/i.test(t)) scoresRef.focus += 0.7;
            if(low.length > 0 && low.length < 16){
              scoresRef.focus += 0.15;
              scoresRef.think += 0.15;
            }
          }
        });
        return pickBestEmotion(scores, 'focus');
      }

      return {
        id: 'scheme1',
        title: '方案一（当前实现）',
        footerText: '12 种预设表情：基础情绪（快乐/悲伤/愤怒/恐惧惊讶/厌恶）＋交互状态（专注/思考/确认/困惑）＋社交信号（眨眼/困倦/庆祝）。',
        footerHint: '说明：方案一完整保留当前实现，含眼睛、嘴巴与辅助符号组合。',
        defaultEmotionId: 'focus',
        emotions: EMOTIONS,
        emotionById: EMOTION_BY_ID,
        examples,
        patternFor,
        pickEmotion
      };
    }

    function createSchemeTwo(){
      const EMOTIONS = [
        { id:'flirting', emoji:'😏', label:'挑逗', color:'#f7fbff' },
        { id:'joyful', emoji:'😄', label:'快乐', color:'#f7fbff' },
        { id:'angry', emoji:'😠', label:'愤怒', color:'#fff8f4' },
        { id:'sad', emoji:'😢', label:'悲伤', color:'#f7fbff' },
        { id:'anxious', emoji:'😟', label:'焦虑', color:'#f7fbff' },
        { id:'sceptical', emoji:'🧐', label:'怀疑', color:'#f7fbff' },
        { id:'bright', emoji:'💡', label:'盛赞', color:'#fff9df' },
        { id:'listening', emoji:'👂', label:'倾听', color:'#f7fbff' },
        { id:'sweating', emoji:'😅', label:'流汗', color:'#f7fbff' },
        { id:'brooding', emoji:'🤔', label:'思考', color:'#f7fbff' },
        { id:'pleased', emoji:'😌', label:'愉快', color:'#f7fbff' },
        { id:'sorry', emoji:'🥺', label:'抱歉', color:'#f7fbff' }
      ];
      const EMOTION_BY_ID = Object.fromEntries(EMOTIONS.map((item)=>[item.id, item]));
      const FACE = { leftEyeX: 8, rightEyeX: 16, eyeY: 12.1, browY: 6.0 };
      const TEAR_COLOR = '#7be8ff';
      const SWEAT_COLOR = '#7be8ff';
      const RAY_COLOR = '#90ffe1';

      function faceBase(){ return makeMatrix(0); }
      function lineStroke(m, x0, y0, x1, y1, thickness){
        drawThick(m, (mm)=>{ drawLine(mm, x0, y0, x1, y1, 2); }, (thickness === null || thickness === undefined) ? 0.72 : thickness);
      }
      function arcStroke(m, cx, cy, radius, start, end, thickness){
        drawThick(m, (mm)=>{ drawArc(mm, cx, cy, radius, start, end, 2); }, (thickness === null || thickness === undefined) ? 0.8 : thickness);
      }
      function eyeArcUp(m, cx, cy, radius, tilt){
        const eyeY = (cy === null || cy === undefined) ? FACE.eyeY : cy;
        const r = radius || 2.1;
        arcStroke(m, cx, eyeY + (tilt || 0), r, Math.PI * 0.14, Math.PI * 0.86, 0.82);
      }
      function eyeArcDown(m, cx, cy, radius, tilt){
        const eyeY = (cy === null || cy === undefined) ? FACE.eyeY : cy;
        const r = radius || 2.05;
        arcStroke(m, cx, eyeY + (tilt || 0), r, Math.PI * 1.14, Math.PI * 1.86, 0.82);
      }
      function ringEye(m, cx, cy, radius, thickness){
        arcStroke(m, cx, cy, radius || 1.95, 0, Math.PI * 2, (thickness === null || thickness === undefined) ? 0.82 : thickness);
      }
      function eyeRings(m, opts){
        const cfg = opts || {};
        ringEye(m, FACE.leftEyeX, FACE.eyeY + (cfg.leftOffset || 0), cfg.radius, cfg.thickness);
        ringEye(m, FACE.rightEyeX, FACE.eyeY + (cfg.rightOffset || 0), cfg.radius, cfg.thickness);
      }
      function browLineSingle(m, cx, y, width, tilt, thickness){
        const half = (width || 3.8) / 2;
        const slant = tilt || 0;
        lineStroke(m, cx - half, y - slant, cx + half, y + slant, thickness);
      }
      function browArcUpSingle(m, cx, y, radius, thickness){
        arcStroke(m, cx, y, radius || 1.8, Math.PI * 1.14, Math.PI * 1.86, (thickness === null || thickness === undefined) ? 0.76 : thickness);
      }
      function browArcDownSingle(m, cx, y, radius, thickness){
        arcStroke(m, cx, y, radius || 1.8, Math.PI * 0.14, Math.PI * 0.86, (thickness === null || thickness === undefined) ? 0.76 : thickness);
      }
      function joyfulBrows(m){
        browArcUpSingle(m, FACE.leftEyeX, FACE.browY, 1.75, 0.74);
        browArcUpSingle(m, FACE.rightEyeX, FACE.browY, 1.75, 0.74);
      }
      function angryBrows(m){
        browLineSingle(m, FACE.leftEyeX, FACE.browY - 0.05, 3.9, -0.48, 0.82);
        browLineSingle(m, FACE.rightEyeX, FACE.browY - 0.05, 3.9, 0.48, 0.82);
      }
      function sadBrows(m){
        browArcDownSingle(m, FACE.leftEyeX, FACE.browY - 0.15, 1.7, 0.74);
        browArcDownSingle(m, FACE.rightEyeX, FACE.browY - 0.15, 1.7, 0.74);
      }
      function anxiousBrows(m){
        browLineSingle(m, FACE.leftEyeX, FACE.browY, 3.9, 0, 0.78);
        browLineSingle(m, FACE.rightEyeX, FACE.browY, 3.9, 0, 0.78);
      }
      function scepticalBrows(m){
        browArcUpSingle(m, FACE.leftEyeX, FACE.browY - 0.2, 1.65, 0.74);
        browLineSingle(m, FACE.rightEyeX, FACE.browY + 0.35, 3.6, 0, 0.76);
      }
      function brightBrows(m){
        joyfulBrows(m);
      }
      function listeningBrows(m){
        browLineSingle(m, FACE.leftEyeX, FACE.browY + 0.25, 3.5, 0, 0.76);
        browLineSingle(m, FACE.rightEyeX, FACE.browY + 0.25, 3.5, 0, 0.76);
      }
      function sweatingBrows(m){
        browArcUpSingle(m, FACE.leftEyeX, FACE.browY - 0.05, 1.75, 0.74);
        browArcUpSingle(m, FACE.rightEyeX, FACE.browY - 0.05, 1.75, 0.74);
      }
      function broodingBrows(m){
        browLineSingle(m, FACE.leftEyeX, FACE.browY, 4.4, 0, 1.02);
        browLineSingle(m, FACE.rightEyeX, FACE.browY, 4.4, 0, 1.02);
      }
      function pleasedBrows(m){
        browArcUpSingle(m, FACE.leftEyeX, FACE.browY + 0.05, 1.6, 0.74);
        browArcUpSingle(m, FACE.rightEyeX, FACE.browY + 0.05, 1.6, 0.74);
      }
      function sorryBrows(m){
        browArcDownSingle(m, FACE.leftEyeX, FACE.browY + 0.35, 1.45, 0.7);
        browArcDownSingle(m, FACE.rightEyeX, FACE.browY + 0.35, 1.45, 0.7);
      }
      function flirtingMarks(m){
        browArcDownSingle(m, FACE.leftEyeX - 0.25, FACE.browY + 0.4, 1.55, 0.58);
        lineStroke(m, FACE.leftEyeX - 1.95, FACE.eyeY - 0.45, FACE.leftEyeX + 0.65, FACE.eyeY + 1.55, 0.58);
        browArcUpSingle(m, FACE.rightEyeX + 0.2, FACE.browY - 0.1, 1.5, 0.58);
        arcStroke(m, FACE.rightEyeX + 0.15, FACE.eyeY - 0.65, 2.0, Math.PI * 0.14, Math.PI * 0.86, 0.58);
      }
      function joyfulEyes(m, sway){
        eyeArcUp(m, FACE.leftEyeX, FACE.eyeY + sway, 2.1, 0);
        eyeArcUp(m, FACE.rightEyeX, FACE.eyeY + sway, 2.1, 0);
      }
      function sadEyes(m){
        eyeArcDown(m, FACE.leftEyeX, FACE.eyeY + 0.15, 2.0, 0);
        eyeArcDown(m, FACE.rightEyeX, FACE.eyeY + 0.15, 2.0, 0);
      }
      function brightEyes(m){
        eyeArcUp(m, FACE.leftEyeX, FACE.eyeY, 2.0, 0);
        eyeArcUp(m, FACE.rightEyeX, FACE.eyeY, 2.0, 0);
      }
      function sweatingEyes(m, sway){
        eyeArcUp(m, FACE.leftEyeX, FACE.eyeY + sway * 0.7, 2.0, 0);
        eyeArcUp(m, FACE.rightEyeX, FACE.eyeY + sway * 0.7, 2.0, 0);
      }
      function pleasedEyes(m){
        eyeArcUp(m, FACE.leftEyeX, FACE.eyeY + 0.05, 1.95, -0.22);
        eyeArcUp(m, FACE.rightEyeX, FACE.eyeY + 0.05, 1.95, 0.22);
      }
      function addScepticalLeftEyeBump(m){
        lineStroke(m, FACE.leftEyeX - 0.6, FACE.eyeY - 2.3, FACE.leftEyeX + 0.35, FACE.eyeY - 2.65, 0.5);
      }
      function tearAccent(side){
        const accent = makeMatrix(0);
        const x = side === 'left' ? 5.35 : 18.0;
        const y = FACE.eyeY + 3.0;
        fillCircle(accent, x, y - 0.25, 0.38, 2);
        lineStroke(accent, x - 0.08, y, x + 0.3, y + 1.05, 0.46);
        lineStroke(accent, x + 0.3, y + 1.05, x + 0.82, y + 0.45, 0.46);
        return accent;
      }
      function sweatAccents(){
        return [
          { matrix: tearAccent('right'), color: SWEAT_COLOR, intensity: 1 },
          { matrix: (()=>{
            const accent = makeMatrix(0);
            const x = 20.0;
            const y = FACE.eyeY + 1.65;
            fillCircle(accent, x, y - 0.22, 0.34, 2);
            lineStroke(accent, x - 0.04, y, x + 0.22, y + 0.88, 0.44);
            lineStroke(accent, x + 0.22, y + 0.88, x + 0.72, y + 0.32, 0.44);
            return accent;
          })(), color: SWEAT_COLOR, intensity: 1 }
        ];
      }
      function rayAccents(){
        const accent = makeMatrix(0);
        lineStroke(accent, 8.9, 2.9, 8.6, 1.2, 0.5);
        lineStroke(accent, 12.0, 2.7, 12.0, 0.9, 0.5);
        lineStroke(accent, 15.1, 2.9, 15.4, 1.2, 0.5);
        return accent;
      }

      function patternFor(emotionId, t){
        const base = faceBase();
        const accents = [];
        const sway = Math.sin(t * 0.0024) * 0.12;

        switch(emotionId){
          case 'flirting':
            flirtingMarks(base);
            break;
          case 'joyful':
            joyfulBrows(base);
            joyfulEyes(base, sway);
            break;
          case 'angry':
            angryBrows(base);
            eyeRings(base, { radius: 1.9 });
            break;
          case 'sad':
            sadBrows(base);
            sadEyes(base);
            accents.push({ matrix: tearAccent('left'), color: TEAR_COLOR, intensity: 1 });
            break;
          case 'anxious':
            anxiousBrows(base);
            eyeRings(base, { radius: 1.95 });
            break;
          case 'sceptical':
            scepticalBrows(base);
            eyeRings(base, { radius: 1.92 });
            addScepticalLeftEyeBump(base);
            break;
          case 'bright':
            brightBrows(base);
            brightEyes(base);
            accents.push({ matrix: rayAccents(), color: RAY_COLOR, intensity: 1 });
            break;
          case 'listening':
            listeningBrows(base);
            eyeRings(base, { radius: 1.92 });
            break;
          case 'sweating':
            sweatingBrows(base);
            sweatingEyes(base, sway);
            sweatAccents().forEach((accent)=>accents.push(accent));
            break;
          case 'brooding':
            broodingBrows(base);
            eyeRings(base, { radius: 1.92, thickness: 0.84 });
            break;
          case 'pleased':
            pleasedBrows(base);
            pleasedEyes(base);
            break;
          case 'sorry':
            sorryBrows(base);
            eyeRings(base, { radius: 1.6, thickness: 0.76 });
            break;
          default:
            listeningBrows(base);
            eyeRings(base, { radius: 1.92 });
        }

        return centerRenderSpec({ base, accents });
      }

      const RULES = {
        flirting: { kws:['挑逗','撩','撩你','逗你','调皮','嘿嘿','你懂的','坏笑','眨眼','wink','tease','flirt','playful','just kidding','jk'], re:[/;\)/, /😉/] },
        joyful: { kws:['快乐','开心','高兴','太好了','笑死','哈哈','哈哈哈','好开心','喜欢','赞','好耶','yay','happy','joyful','glad','delighted','lol'], re:[/\bso\s*happy\b/i] },
        angry: { kws:['愤怒','生气','火大','气死','别再','烦死','讨厌','警告','滚','离谱','angry','mad','furious','annoyed','hate'], re:[/!{2,}/, /\bwtf\b/i] },
        sad: { kws:['悲伤','难过','伤心','失落','流泪','心碎','沮丧','sad','down','upset','blue','heartbroken'], re:[/T_T/i] },
        anxious: { kws:['焦虑','紧张','担心','害怕','慌','忐忑','压力大','anxious','nervous','worried','stressed','panic'], re:[/\bomg\b/i] },
        sceptical: { kws:['怀疑','真的假的','不太信','确定吗','可疑','再想想','真的吗','skeptical','sceptical','doubt','really','are you sure','not convinced'], re:[/\?{2,}/] },
        bright: { kws:['盛赞','太妙了','绝了','好主意','灵感','脑洞大开','brilliant','genius','smart idea','great idea','amazing idea','clever'], re:[/\bbravo\b/i] },
        listening: { kws:['倾听','我在听','继续说','请讲','说吧','嗯嗯','在听','listening','go on','tell me more','i am listening','i\'m listening'], re:[/\bcarry\s*on\b/i] },
        sweating: { kws:['流汗','冒汗','尴尬','救命','压力山大','我慌了','汗流浃背','sweating','awkward','oops','yikes','embarrassed'], re:[/汗+/] },
        brooding: { kws:['思考','想想','让我想想','分析一下','斟酌','琢磨','推理','processing','thinking','let me think','considering','brooding'], re:[/\.\.\./] },
        pleased: { kws:['愉快','得意','满意','不错嘛','稳了','拿捏','舒坦','pleased','smug','satisfied','feeling good'], re:[/呵呵/] },
        sorry: { kws:['抱歉','对不起','不好意思','失礼了','sorry','apologies','my bad','forgive me'], re:[/\bsorry\b/i] }
      };

      const examples = [
        { t:'嘿嘿，逗你一下，你懂的。', id:'flirting' },
        { t:'太开心了，今天真是个好消息！', id:'joyful' },
        { t:'别再这样了，我真的有点生气！！', id:'angry' },
        { t:'这次结果让我有点难过……', id:'sad' },
        { t:'我有点焦虑，担心会不会出问题。', id:'anxious' },
        { t:'真的吗？我还是有点怀疑。', id:'sceptical' },
        { t:'这个主意太妙了，简直绝了！', id:'bright' },
        { t:'你继续说，我在认真听。', id:'listening' },
        { t:'啊这，有点尴尬，我都开始冒汗了。', id:'sweating' },
        { t:'让我再想想，先分析一下。', id:'brooding' },
        { t:'不错嘛，这波我挺满意。', id:'pleased' },
        { t:'抱歉，这件事是我没处理好。', id:'sorry' }
      ];

      function pickEmotion(text){
        const { scores } = scoreWithRules(text, RULES, {
          after(scoresRef, t, low, meta){
            if(meta.exclaim >= 2){
              scoresRef.joyful += 0.9;
              scoresRef.angry += 0.5;
              scoresRef.bright += 0.8;
            }
            if(meta.ques >= 1) scoresRef.sceptical += 0.45;
            if(meta.ques >= 2) scoresRef.sceptical += 0.8;
            if(meta.ellipsis >= 1){
              scoresRef.sad += 0.35;
              scoresRef.brooding += 0.5;
              scoresRef.sorry += 0.25;
            }
            if(/(抱歉|对不起|不好意思|sorry)/i.test(t)) scoresRef.sorry += 0.9;
            if(/(焦虑|紧张|压力|担心|nervous|worried|stress)/i.test(t)) scoresRef.anxious += 0.7;
            if(/(灵感|妙|绝了|brilliant|genius|great idea)/i.test(t)) scoresRef.bright += 0.75;
            if(/(继续说|我在听|listening|go on)/i.test(t)) scoresRef.listening += 0.8;
            if(/(尴尬|冒汗|awkward|oops)/i.test(t)) scoresRef.sweating += 0.75;
            if(/(让我想想|思考|thinking|processing|consider)/i.test(low)) scoresRef.brooding += 0.8;
            if(/(得意|满意|不错嘛|smug|satisfied)/i.test(t)) scoresRef.pleased += 0.75;
            if(/(开心|高兴|happy|joyful|哈哈)/i.test(t)) scoresRef.joyful += 0.7;
            if(low.length > 0 && low.length < 16) scoresRef.listening += 0.18;
          }
        });
        return pickBestEmotion(scores, 'listening');
      }

      return {
        id: 'scheme2',
        title: '方案二（纯眼睛参考图）',
        footerText: '12 种预设表情：挑逗、快乐、愤怒、悲伤、焦虑、怀疑、盛赞、倾听、流汗、思考、愉快、抱歉。默认态为“倾听”。',
        footerHint: '说明：方案二按参考图重绘为纯眼睛风格，采用圆弧眼眶 + 圆环瞳孔 + 局部汗滴/泪滴/放射线规则匹配。',
        defaultEmotionId: 'listening',
        emotions: EMOTIONS,
        emotionById: EMOTION_BY_ID,
        examples,
        patternFor,
        pickEmotion
      };
    }

    const SCHEMES = {
      scheme1: createSchemeOne(),
      scheme2: createSchemeTwo()
    };

    let activeScheme = SCHEMES.scheme2;
    let currentEmotionId = activeScheme.defaultEmotionId;

    function updateSchemeUi(){
      if(schemeInfoEl) schemeInfoEl.textContent = activeScheme.title;
      if(footerTextEl) footerTextEl.textContent = activeScheme.footerText;
      if(footerHintEl) footerHintEl.textContent = activeScheme.footerHint;
    }

    function rebuildChips(){
      if(!chipsEl) return;
      chipsEl.innerHTML = '';
      activeScheme.examples.forEach((item)=>{
        const el = document.createElement('div');
        el.className = 'chip';
        el.textContent = item.t;
        el.title = '点击填入并分析';
        el.addEventListener('click', ()=>{
          textEl.value = item.t;
          setEmotion(item.id);
        });
        chipsEl.appendChild(el);
      });
    }

    function chooseScheme(forcePrompt){
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if(!forcePrompt && (saved === 'scheme1' || saved === 'scheme2')) return saved;
      const defaultInput = saved === 'scheme1' ? '1' : '2';
      const answer = window.prompt(
        '请选择表情方案：\n1 = 方案一（保留当前实现）\n2 = 方案二（参考图纯眼睛版）',
        defaultInput
      );
      return String(answer || '').trim() === '1' ? 'scheme1' : 'scheme2';
    }

    function setEmotion(id){
      if(!activeScheme.emotionById[id]) id = activeScheme.defaultEmotionId;
      currentEmotionId = id;
      const emotion = activeScheme.emotionById[id];
      emotionLabelEl.innerHTML = `${emotion.emoji} 当前情绪：<span style="color:rgba(255,255,255,.86)">${emotion.label}</span> <span class="tiny">· ${activeScheme.title}</span>`;
      if(id === 'angry' || id === 'fear' || id === 'anxious'){
        screenWrap.classList.remove('shake');
        void screenWrap.offsetWidth;
        screenWrap.classList.add('shake');
      }
      return currentEmotionId;
    }

    function pickEmotion(text){
      return activeScheme.pickEmotion(text);
    }

    function analyze(){
      const txt = textEl.value;
      const { bestId } = pickEmotion(txt);
      setEmotion(bestId);
    }

    function randomExample(){
      const samples = activeScheme.examples;
      const sample = samples[Math.floor(Math.random() * samples.length)];
      textEl.value = sample.t;
      analyze();
    }

    function applyScheme(schemeId){
      activeScheme = SCHEMES[schemeId] || SCHEMES.scheme2;
      window.localStorage.setItem(STORAGE_KEY, activeScheme.id);
      updateSchemeUi();
      rebuildChips();
      if(normText(textEl.value)){
        analyze();
      } else {
        setEmotion(activeScheme.defaultEmotionId);
      }
    }

    function promptAndApplyScheme(){
      applyScheme(chooseScheme(true));
    }

    function tick(t){
      const emotion = activeScheme.emotionById[currentEmotionId] || activeScheme.emotionById[activeScheme.defaultEmotionId];
      const renderSpec = activeScheme.patternFor(currentEmotionId, t);
      drawLED(renderSpec, emotion.color || '#f7fbff');
    }

    function init(){
      applyScheme(chooseScheme(false));
    }

    return {
      pickEmotion,
      setEmotion,
      drawLED,
      analyze,
      randomExample,
      promptAndApplyScheme,
      tick,
      init
    };
  }

  window.createExpressionSchemeRuntime = createExpressionSchemeRuntime;
})();
