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

    function createSchemeTwo(config){
      const schemeConfig = Object.assign({
        id: 'scheme2',
        title: '方案二（纯眼睛参考图）',
        footerText: '12 种预设表情：挑逗、快乐、愤怒、悲伤、焦虑、怀疑、盛赞、倾听、流汗、思考、愉快、抱歉。默认态为“倾听”。',
        footerHint: '说明：方案二不再模拟 LED 点阵，直接在黑色屏幕区域内用 Canvas 线条重绘 12 种表情。',
        defaultEmotionId: 'listening',
        emotionColorOverrides: {},
        palette: {
          bg: '#02030a',
          line: '#ffffff',
          accent: '#5ce8d0'
        }
      }, config || {});
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
      ].map((item)=>({
        ...item,
        color: schemeConfig.emotionColorOverrides[item.id] || item.color
      }));
      const EMOTION_BY_ID = Object.fromEntries(EMOTIONS.map((item)=>[item.id, item]));
      const PALETTE = schemeConfig.palette;

      function getScene(){
        const W = canvas.width;
        const H = canvas.height;
        const dim = Math.min(W, H);
        const board = dim * 0.72;
        return {
          W,
          H,
          dim,
          board,
          unit: board / 24,
          ox: (W - board) / 2,
          oy: (H - board) / 2,
          lineWidth: Math.max(8, dim * 0.034)
        };
      }
      function point(scene, x, y){
        return [scene.ox + x * scene.unit, scene.oy + y * scene.unit];
      }
      function resolveStrokeColor(emotion){
        return (emotion && emotion.color) || PALETTE.line;
      }
      function resolveAccentColor(emotion){
        return (emotion && emotion.accentColor) || PALETTE.accent;
      }
      function clearSchemeTwo(scene){
        ctx.clearRect(0, 0, scene.W, scene.H);
        ctx.fillStyle = PALETTE.bg;
        ctx.fillRect(0, 0, scene.W, scene.H);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
      function strokePath(color, width){
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowBlur = width * 1.2;
        ctx.shadowColor = color;
      }
      function drawLineShape(scene, x0, y0, x1, y1, widthScale, color){
        const [sx, sy] = point(scene, x0, y0);
        const [ex, ey] = point(scene, x1, y1);
        ctx.save();
        strokePath(color || PALETTE.line, scene.lineWidth * (widthScale || 1));
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.restore();
      }
      function drawQuadraticShape(scene, x0, y0, cpx, cpy, x1, y1, widthScale, color){
        const [sx, sy] = point(scene, x0, y0);
        const [cp1x, cp1y] = point(scene, cpx, cpy);
        const [ex, ey] = point(scene, x1, y1);
        ctx.save();
        strokePath(color || PALETTE.line, scene.lineWidth * (widthScale || 1));
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(cp1x, cp1y, ex, ey);
        ctx.stroke();
        ctx.restore();
      }
      function drawBezierShape(scene, x0, y0, cp1x, cp1y, cp2x, cp2y, x1, y1, widthScale, color){
        const [sx, sy] = point(scene, x0, y0);
        const [bx1, by1] = point(scene, cp1x, cp1y);
        const [bx2, by2] = point(scene, cp2x, cp2y);
        const [ex, ey] = point(scene, x1, y1);
        ctx.save();
        strokePath(color || PALETTE.line, scene.lineWidth * (widthScale || 1));
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(bx1, by1, bx2, by2, ex, ey);
        ctx.stroke();
        ctx.restore();
      }
      function drawArcShape(scene, cx, cy, radius, start, end, widthScale, color){
        const [px, py] = point(scene, cx, cy);
        ctx.save();
        strokePath(color || PALETTE.line, scene.lineWidth * (widthScale || 1));
        ctx.beginPath();
        ctx.arc(px, py, radius * scene.unit, start, end);
        ctx.stroke();
        ctx.restore();
      }
      function drawCircleShape(scene, cx, cy, radius, widthScale, color){
        drawArcShape(scene, cx, cy, radius, 0, Math.PI * 2, widthScale, color || PALETTE.line);
      }
      function drawDropShape(scene, cx, cy, scale, color){
        const [px, py] = point(scene, cx, cy);
        const s = scene.unit * scale;
        ctx.save();
        ctx.fillStyle = color || PALETTE.accent;
        ctx.shadowBlur = scene.lineWidth * 1.1;
        ctx.shadowColor = color || PALETTE.accent;
        ctx.beginPath();
        ctx.moveTo(px, py - s * 1.2);
        ctx.quadraticCurveTo(px + s * 0.9, py - s * 0.3, px + s * 0.55, py + s * 0.6);
        ctx.quadraticCurveTo(px, py + s * 1.35, px - s * 0.55, py + s * 0.6);
        ctx.quadraticCurveTo(px - s * 0.9, py - s * 0.3, px, py - s * 1.2);
        ctx.fill();
        ctx.restore();
      }
      function drawRotatedDrop(scene, cx, cy, scale, angleDeg, color){
        const [px, py] = point(scene, cx, cy);
        const s = scene.unit * scale;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angleDeg * Math.PI / 180);
        ctx.fillStyle = color || PALETTE.accent;
        ctx.shadowBlur = scene.lineWidth * 1.05;
        ctx.shadowColor = color || PALETTE.accent;
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.1);
        ctx.quadraticCurveTo(s * 0.85, -s * 0.22, s * 0.52, s * 0.55);
        ctx.quadraticCurveTo(0, s * 1.25, -s * 0.52, s * 0.55);
        ctx.quadraticCurveTo(-s * 0.85, -s * 0.22, 0, -s * 1.1);
        ctx.fill();
        ctx.restore();
      }
      function fillCircleShape(scene, cx, cy, radius, color){
        const [px, py] = point(scene, cx, cy);
        ctx.save();
        ctx.fillStyle = color || PALETTE.bg;
        ctx.beginPath();
        ctx.arc(px, py, radius * scene.unit, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      function topArc(scene, cx, cy, radius, widthScale, color){
        drawArcShape(scene, cx, cy, radius, Math.PI * 0.15, Math.PI * 0.85, widthScale, color);
      }
      function drawSchemeTwo(emotionId, t, emotion){
        const scene = getScene();
        const strokeColor = resolveStrokeColor(emotion);
        const accentColor = resolveAccentColor(emotion);
        clearSchemeTwo(scene);
        switch(emotionId){
          case 'flirting':
            drawQuadraticShape(scene, 5.45, 7.0, 6.8, 7.45, 8.45, 7.2, 0.82, strokeColor);
            drawQuadraticShape(scene, 5.55, 9.85, 7.05, 10.25, 8.6, 10.7, 0.82, strokeColor);
            drawQuadraticShape(scene, 13.7, 6.95, 15.2, 6.2, 16.9, 7.0, 0.82, strokeColor);
            drawBezierShape(scene, 13.5, 12.0, 13.7, 9.75, 16.8, 9.6, 16.6, 12.2, 0.82, strokeColor);
            break;
          case 'joyful':
            drawQuadraticShape(scene, 5.8, 7.4, 7.2, 5.9, 8.9, 6.35, 0.82, strokeColor);
            drawQuadraticShape(scene, 15.1, 6.35, 16.8, 5.9, 18.2, 7.4, 0.82, strokeColor);
            drawArcShape(scene, 8.1, 12.1, 2.15, Math.PI, 0, 0.9, strokeColor);
            drawArcShape(scene, 15.9, 12.1, 2.15, Math.PI, 0, 0.9, strokeColor);
            break;
          case 'angry':
            drawLineShape(scene, 6.0, 5.5, 9.5, 7.1, 0.88, strokeColor);
            drawLineShape(scene, 14.0, 7.1, 17.5, 5.5, 0.88, strokeColor);
            drawCircleShape(scene, 8.0, 12.2, 1.85, 0.92, strokeColor);
            drawCircleShape(scene, 16.0, 12.2, 1.85, 0.92, strokeColor);
            break;
          case 'sad':
            drawQuadraticShape(scene, 5.8, 7.5, 7.3, 7.0, 9.1, 6.3, 0.8, strokeColor);
            drawQuadraticShape(scene, 14.9, 6.3, 16.7, 7.0, 18.2, 7.5, 0.8, strokeColor);
            drawArcShape(scene, 8.0, 11.4, 1.95, 0, Math.PI, 0.86, strokeColor);
            drawArcShape(scene, 16.0, 11.4, 1.95, 0, Math.PI, 0.86, strokeColor);
            drawDropShape(scene, 4.9, 14.5, 0.72, '#66FFFF');
            break;
          case 'anxious':
            drawQuadraticShape(scene, 5.9, 7.5, 7.6, 7.0, 9.5, 6.7, 0.82, strokeColor);
            drawQuadraticShape(scene, 14.5, 6.7, 16.4, 7.0, 18.1, 7.5, 0.82, strokeColor);
            drawCircleShape(scene, 8.0, 12.15, 1.94, 0.9, strokeColor);
            drawCircleShape(scene, 16.0, 12.15, 1.94, 0.9, strokeColor);
            break;
          case 'sceptical':
            topArc(scene, 8.0, 6.35, 1.55, 0.82, strokeColor);
            drawLineShape(scene, 14.3, 7.9, 17.9, 7.2, 0.8, strokeColor);
            drawCircleShape(scene, 8.0, 12.1, 1.88, 0.9, strokeColor);
            drawCircleShape(scene, 16.0, 12.1, 1.88, 0.9, strokeColor);
            topArc(scene, 7.55, 10.05, 0.62, 0.52, strokeColor);
            break;
          case 'bright':
            drawQuadraticShape(scene, 5.8, 7.4, 7.2, 5.9, 8.9, 6.35, 0.82, strokeColor);
            drawQuadraticShape(scene, 15.1, 6.35, 16.8, 5.9, 18.2, 7.4, 0.82, strokeColor);
            drawArcShape(scene, 8.1, 12.1, 2.15, Math.PI, 0, 0.9, strokeColor);
            drawArcShape(scene, 15.9, 12.1, 2.15, Math.PI, 0, 0.9, strokeColor);
            drawLineShape(scene, 9.3, 3.7, 8.5, 1.9, 0.58, accentColor);
            drawLineShape(scene, 12.0, 3.35, 12.0, 1.15, 0.58, accentColor);
            drawLineShape(scene, 14.7, 3.7, 15.5, 1.9, 0.58, accentColor);
            break;
          case 'listening':
            drawLineShape(scene, 6.4, 7.2, 9.6, 7.2, 0.8, strokeColor);
            drawLineShape(scene, 14.4, 7.2, 17.6, 7.2, 0.8, strokeColor);
            drawCircleShape(scene, 8.0, 12.1, 1.88, 0.9, strokeColor);
            drawCircleShape(scene, 16.0, 12.1, 1.88, 0.9, strokeColor);
            break;
          case 'sweating':
            drawQuadraticShape(scene, 5.8, 7.4, 7.2, 5.9, 8.9, 6.35, 0.82, strokeColor);
            drawQuadraticShape(scene, 15.1, 6.35, 16.8, 5.9, 18.2, 7.4, 0.82, strokeColor);
            drawArcShape(scene, 8.1, 12.1, 2.15, Math.PI, 0, 0.9, strokeColor);
            drawArcShape(scene, 15.9, 12.1, 2.15, Math.PI, 0, 0.9, strokeColor);
            drawRotatedDrop(scene, 19.05, 10.95, 0.62, -42, '#66E6FF');
            drawRotatedDrop(scene, 18.25, 14.2, 0.7, -52, '#66E6FF');
            break;
          case 'brooding':
            drawQuadraticShape(scene, 5.8, 6.7, 7.9, 6.0, 10.1, 6.45, 0.9, strokeColor);
            drawQuadraticShape(scene, 13.9, 6.45, 16.0, 6.8, 18.2, 6.2, 0.9, strokeColor);
            drawCircleShape(scene, 8.0, 12.1, 1.88, 0.9, strokeColor);
            drawCircleShape(scene, 16.0, 12.1, 1.88, 0.9, strokeColor);
            fillCircleShape(scene, 8.55, 11.45, 0.55, PALETTE.bg);
            fillCircleShape(scene, 16.55, 11.45, 0.55, PALETTE.bg);
            break;
          case 'pleased':
            drawQuadraticShape(scene, 5.9, 6.95, 7.9, 6.25, 10.0, 6.9, 0.8, strokeColor);
            drawQuadraticShape(scene, 14.0, 6.9, 16.1, 6.25, 18.1, 6.95, 0.8, strokeColor);
            drawArcShape(scene, 8.1, 12.1, 2.15, Math.PI, 0, 0.92, strokeColor);
            drawArcShape(scene, 15.9, 12.1, 2.15, Math.PI, 0, 0.92, strokeColor);
            break;
          case 'sorry':
            drawQuadraticShape(scene, 6.0, 7.7, 7.3, 7.35, 8.9, 6.55, 0.78, strokeColor);
            drawQuadraticShape(scene, 15.1, 6.55, 16.7, 7.35, 18.0, 7.7, 0.78, strokeColor);
            drawCircleShape(scene, 8.0, 12.2, 1.58, 0.82, strokeColor);
            drawCircleShape(scene, 16.0, 12.2, 1.58, 0.82, strokeColor);
            break;
          default:
            drawLineShape(scene, 6.4, 7.2, 9.6, 7.2, 0.8, strokeColor);
            drawLineShape(scene, 14.4, 7.2, 17.6, 7.2, 0.8, strokeColor);
            drawCircleShape(scene, 8.0, 12.1, 1.88, 0.9, strokeColor);
            drawCircleShape(scene, 16.0, 12.1, 1.88, 0.9, strokeColor);
        }
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
        id: schemeConfig.id,
        title: schemeConfig.title,
        footerText: schemeConfig.footerText,
        footerHint: schemeConfig.footerHint,
        defaultEmotionId: schemeConfig.defaultEmotionId,
        emotions: EMOTIONS,
        emotionById: EMOTION_BY_ID,
        examples,
        draw: drawSchemeTwo,
        pickEmotion
      };
    }

    const SCHEMES = {
      scheme1: createSchemeOne(),
      scheme2: createSchemeTwo(),
      scheme3: createSchemeTwo({
        id: 'scheme3',
        title: '方案三（纯眼睛柔和情绪色）',
        footerText: '基于方案二的纯眼睛结构，保留 12 种预设表情，并为愤怒/快乐/倾听注入更柔和的情绪色彩。默认态为“倾听”。',
        footerHint: '说明：方案三延续方案二的线条轮廓，仅将愤怒调整为淡红、快乐调整为淡绿、倾听调整为淡蓝，其余表情保持原有风格。',
        emotionColorOverrides: {
          angry: '#ffb3b8',
          joyful: '#b9f3c4',
          listening: '#b8e9ff'
        }
      })
    };

    let activeScheme = SCHEMES.scheme2;
    let currentEmotionId = activeScheme.defaultEmotionId;
    let hasAnimatedEmotion = false;
    let switchAnimTimer = null;
    const GLOW_BY_ID = {
      happy: '#ffd86b',
      joyful: '#ffd86b',
      party: '#b6ff4a',
      bright: '#ffd86b',
      confirm: '#6bffb6',
      sad: '#67c8ff',
      sorry: '#9fc7ff',
      sweating: '#66e6ff',
      angry: '#ff5f7f',
      fear: '#8ea4ff',
      anxious: '#8ea4ff',
      listening: '#32e7ff',
      focus: '#32e7ff',
      sceptical: '#d4b4ff',
      brooding: '#b89fff',
      think: '#ffb56a',
      pleased: '#ffe38a',
      flirting: '#ff8fd5',
      disgust: '#8eff88',
      sleepy: '#8aa0ff',
      confuse: '#ff8df2',
      wink: '#ff77de'
    };
    const SCHEME_GLOW_OVERRIDES = {
      scheme3: {
        angry: '#ffb3b8',
        joyful: '#b9f3c4',
        listening: '#b8e9ff'
      }
    };

    function resolveGlowColor(id, emotion){
      const schemeGlow = SCHEME_GLOW_OVERRIDES[activeScheme.id] || {};
      return schemeGlow[id] || GLOW_BY_ID[id] || (emotion && emotion.color) || '#18f7ff';
    }

    function applyGlowColor(color){
      screenWrap.style.setProperty('--emotion-glow', color);
      screenWrap.style.setProperty('--emotion-glow-soft', hexToRgba(color, 0.32));
      screenWrap.style.setProperty('--emotion-glow-edge', hexToRgba(color, 0.72));
    }

    function triggerScreenTransition(){
      if(!hasAnimatedEmotion){
        hasAnimatedEmotion = true;
        return;
      }
      screenWrap.classList.remove('is-switching');
      void screenWrap.offsetWidth;
      screenWrap.classList.add('is-switching');
      if(switchAnimTimer) window.clearTimeout(switchAnimTimer);
      switchAnimTimer = window.setTimeout(()=>{
        screenWrap.classList.remove('is-switching');
      }, 440);
    }

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
      if(!forcePrompt && (saved === 'scheme1' || saved === 'scheme2' || saved === 'scheme3')) return saved;
      const defaultInput = saved === 'scheme1' ? '1' : (saved === 'scheme3' ? '3' : '2');
      const answer = window.prompt(
        '请选择表情方案：\n1 = 方案一（保留当前实现）\n2 = 方案二（参考图纯眼睛版）\n3 = 方案三（方案二柔和情绪色版）',
        defaultInput
      );
      const normalized = String(answer || '').trim();
      if(normalized === '1') return 'scheme1';
      if(normalized === '3') return 'scheme3';
      return 'scheme2';
    }

    function setEmotion(id){
      if(!activeScheme.emotionById[id]) id = activeScheme.defaultEmotionId;
      currentEmotionId = id;
      const emotion = activeScheme.emotionById[id];
      emotionLabelEl.innerHTML = `${emotion.emoji} 当前情绪：<span style="color:rgba(255,255,255,.86)">${emotion.label}</span> <span class="tiny">· ${activeScheme.title}</span>`;
      applyGlowColor(resolveGlowColor(id, emotion));
      triggerScreenTransition();
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
      if(typeof activeScheme.draw === 'function'){
        activeScheme.draw(currentEmotionId, t, emotion);
        return;
      }
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
