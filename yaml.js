(function (root) {
  function parseRecords(source) {
    if (typeof source !== 'string') throw new Error('The YAML file must contain text');

    const lines = source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    const recordsIndex = lines.findIndex(line => /^records\s*:\s*(?:#.*)?$/.test(line));
    if (recordsIndex === -1) throw new Error('Expected a top-level "records:" list');

    const records = [];
    for (let i = recordsIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      if (!/^\s/.test(line) && !/^-/.test(line)) break;

      const match = line.match(/^\s*-\s+(.+?)\s*$/);
      if (!match) throw new Error(`Unsupported YAML entry on line ${i + 1}`);
      const value = parseScalar(match[1], i + 1);
      if (!value.trim()) throw new Error(`Empty record on line ${i + 1}`);
      records.push(value);
    }

    if (!records.length) throw new Error('The YAML "records:" list is empty');
    return records;
  }

  function parseScalar(value, lineNumber) {
    if (value[0] === '"') {
      let end = -1;
      for (let i = 1; i < value.length; i++) {
        if (value[i] === '\\') {
          i++;
        } else if (value[i] === '"') {
          end = i;
          break;
        }
      }
      if (end === -1 || !isCommentOrEmpty(value.slice(end + 1))) {
        throw new Error(`Invalid quoted string on line ${lineNumber}`);
      }
      try {
        return JSON.parse(value.slice(0, end + 1));
      } catch {
        throw new Error(`Invalid quoted string on line ${lineNumber}`);
      }
    }

    if (value[0] === "'") {
      let result = '';
      let i = 1;
      let closed = false;
      for (; i < value.length; i++) {
        if (value[i] !== "'") {
          result += value[i];
        } else if (value[i + 1] === "'") {
          result += "'";
          i++;
        } else {
          i++;
          closed = true;
          break;
        }
      }
      if (!closed || !isCommentOrEmpty(value.slice(i))) {
        throw new Error(`Invalid quoted string on line ${lineNumber}`);
      }
      return result;
    }

    const comment = value.search(/\s+#/);
    const plain = (comment === -1 ? value : value.slice(0, comment)).trim();
    if (!plain || plain === '|' || plain === '>') {
      throw new Error(`Unsupported YAML scalar on line ${lineNumber}`);
    }
    return plain;
  }

  function isCommentOrEmpty(value) {
    const rest = value.trim();
    return !rest || rest[0] === '#';
  }

  root.YamlRecords = { parseRecords };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.YamlRecords;
})(typeof globalThis !== 'undefined' ? globalThis : this);
