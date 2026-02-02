/* English Quest — engine.js
   Core grading logic for all question types.
*/
(() => {
  const Engine = {};

  Engine.normalize = (text) => {
    if (text === null || text === undefined) return "";
    return String(text)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  };

  Engine.arrayToSet = (arr) => {
    const s = new Set();
    (arr || []).forEach(v => s.add(Engine.normalize(v)));
    return s;
  };

  Engine.gradeQuestion = (q, userAnswer) => {
    const type = q?.type;
    const result = {
      correct: false,
      user: userAnswer,
      expected: q?.answer ?? q?.keywords ?? null,
      type
    };

    if (!q) return result;

    if (type === "single") {
      const u = Engine.normalize(userAnswer);
      const a = Engine.normalize(q.answer);
      result.correct = (u === a);
      return result;
    }

    if (type === "multi") {
      const uSet = Engine.arrayToSet(Array.isArray(userAnswer) ? userAnswer : []);
      const aSet = Engine.arrayToSet(Array.isArray(q.answer) ? q.answer : []);
      if (uSet.size !== aSet.size) {
        result.correct = false;
        return result;
      }
      for (const v of aSet) {
        if (!uSet.has(v)) {
          result.correct = false;
          return result;
        }
      }
      result.correct = true;
      return result;
    }

    if (type === "exact") {
      const u = Engine.normalize(userAnswer);
      const a = Engine.normalize(q.answer);
      result.correct = (u === a);
      return result;
    }

    if (type === "contains") {
      const u = Engine.normalize(userAnswer);
      const minWords = Number.isFinite(q.minWords) ? q.minWords : (q.minWords ? parseInt(q.minWords, 10) : 0);
      const words = u.length ? u.split(" ").filter(Boolean).length : 0;
      if (minWords && words < minWords) {
        result.correct = false;
        return result;
      }
      const keywords = (q.keywords || []).map(k => Engine.normalize(k)).filter(Boolean);
      if (keywords.length === 0) {
        result.correct = u.length > 0;
        return result;
      }
      for (const k of keywords) {
        if (!u.includes(k)) {
          result.correct = false;
          return result;
        }
      }
      result.correct = true;
      return result;
    }

    return result;
  };

  Engine.prettyAnswer = (val) => {
    if (Array.isArray(val)) return val.join(", ");
    if (val === null || val === undefined) return "";
    return String(val);
  };

  Engine.percent = (a, b) => {
    if (!b) return 0;
    return Math.round((a / b) * 100);
  };

  window.EnglishQuestEngine = Engine;
})();
