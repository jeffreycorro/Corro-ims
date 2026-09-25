"use strict";

const tls = require("tls");
const { formatManilaDate } = require("./manila");

const DEFAULT_MAILBOX = "hrcorcondev@gmail.com";
const DEFAULT_HOST = "imap.gmail.com";
const DEFAULT_PORT = 993;
const MAX_MESSAGES = 40;

function mailboxAddress() {
  return String(process.env.HR_APPLICANTS_IMAP_USER || DEFAULT_MAILBOX).trim();
}

function missingImapEnv() {
  const missing = [];
  if (!String(process.env.HR_APPLICANTS_IMAP_USER || "").trim()) missing.push("HR_APPLICANTS_IMAP_USER");
  if (!String(process.env.HR_APPLICANTS_IMAP_PASS || "").trim()) missing.push("HR_APPLICANTS_IMAP_PASS");
  return missing;
}

function imapConfigured() {
  return missingImapEnv().length === 0;
}

function decodeMimeWord(raw) {
  return String(raw || "").replace(
    /=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g,
    function (_m, _cs, enc, text) {
      try {
        if (String(enc).toUpperCase() === "B") {
          return Buffer.from(text, "base64").toString("utf8");
        }
        return text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, function (__m, hex) {
            return String.fromCharCode(parseInt(hex, 16));
          });
      } catch {
        return text;
      }
    }
  );
}

function parseFrom(raw) {
  const s = decodeMimeWord(raw).replace(/\s+/g, " ").trim();
  const angle = s.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    return {
      name: angle[1].replace(/^["']|["']$/g, "").trim(),
      email: angle[2].trim(),
    };
  }
  if (/@/.test(s)) return { name: "", email: s };
  return { name: s, email: "" };
}

function guessPosition(subject, body) {
  const hay = `${subject}\n${body}`;
  const m =
    hay.match(
      /(?:applying for|application for|apply for|position(?: applied)?[:\s]+|role[:\s]+)([A-Za-z0-9 /&().-]{3,60})/i
    ) || hay.match(/\b(project|site|office|safety|hr|admin|driver|engineer|foreman|labor)[^\n,]{0,40}/i);
  return m ? String(m[1] || m[0]).replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

function guessMobile(body) {
  const m = String(body || "").match(/(?:\+63|0)[\s-]?(?:9\d{2})[\s-]?\d{3}[\s-]?\d{4}/);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

function applicantFromEmail(msg, today) {
  const from = parseFrom(msg && msg.from);
  const subject = decodeMimeWord((msg && msg.subject) || "").trim();
  const body = String((msg && msg.body) || "").slice(0, 4000);
  const name = from.name || (subject.match(/from\s+([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){1,3})/) || [])[1] || "";
  if (!name && !from.email) return null;
  return {
    name: name || from.email,
    email: from.email,
    mobile: guessMobile(body),
    position: guessPosition(subject, body),
    notes: [subject, body.slice(0, 280)].filter(Boolean).join(" — "),
    source: mailboxAddress(),
    appliedOn: (msg && msg.date && /^\d{4}-\d{2}-\d{2}/.test(msg.date) && msg.date.slice(0, 10)) || today || formatManilaDate(),
  };
}

function parseImapFetch(raw) {
  const text = String(raw || "");
  const blocks = text.split(/\* \d+ FETCH /i).slice(1);
  return blocks
    .map(function (block) {
      function hdr(name) {
        const re = new RegExp("^" + name + ":\\s*(.+)$", "im");
        const m = block.match(re);
        return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
      }
      const bodyM = block.match(/BODY\[(?:TEXT|1)\][^\n]*\n([\s\S]*?)(?:\n\)|\nA\d+\s|$)/i);
      return {
        from: hdr("From"),
        subject: hdr("Subject"),
        date: hdr("Date"),
        body: bodyM ? String(bodyM[1]).trim() : "",
      };
    })
    .filter(function (m) {
      return m.from || m.subject;
    });
}

function quotedImap(s) {
  return '"' + String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function imapSince(days) {
  const d = new Date(Date.now() - (Number(days) || 21) * 86400000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function fetchMailboxEmails(opts) {
  opts = opts || {};
  const host = opts.host || process.env.HR_APPLICANTS_IMAP_HOST || DEFAULT_HOST;
  const port = Number(opts.port || process.env.HR_APPLICANTS_IMAP_PORT || DEFAULT_PORT);
  const user = opts.user || process.env.HR_APPLICANTS_IMAP_USER || "";
  const pass = opts.pass || process.env.HR_APPLICANTS_IMAP_PASS || "";
  const box = opts.mailbox || process.env.HR_APPLICANTS_IMAP_MAILBOX || "INBOX";
  const timeoutMs = Number(opts.timeoutMs || 18000);
  if (!user || !pass) {
    const err = new Error("IMAP is not configured");
    err.statusCode = 503;
    err.code = "imap_unconfigured";
    throw err;
  }

  return new Promise(function (resolve, reject) {
    const sock = tls.connect({ host, port, servername: host }, function () {});
    let buf = "";
    let tagN = 0;
    const waiters = [];
    let settled = false;
    let greeted = false;
    let greetRes;

    function fail(err) {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      reject(err);
    }

    const timer = setTimeout(function () {
      fail(Object.assign(new Error("IMAP timed out"), { statusCode: 504 }));
    }, timeoutMs);

    function send(cmd) {
      tagN += 1;
      const tag = "A" + tagN;
      return new Promise(function (res, rej) {
        waiters.push({ tag, res, rej, chunks: [] });
        sock.write(tag + " " + cmd + "\r\n");
      });
    }

    sock.on("data", function (chunk) {
      buf += chunk.toString("utf8");
      buf = buf.replace(/\r\n/g, "\n");
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      lines.forEach(function (line) {
        if (!greeted && /^\* OK /i.test(line)) {
          greeted = true;
          if (greetRes) greetRes();
        }
        const waiter = waiters[0];
        if (!waiter) return;
        waiter.chunks.push(line);
        if (line.indexOf(waiter.tag + " ") === 0) {
          waiters.shift();
          const ok = / OK /i.test(line);
          const raw = waiter.chunks.join("\n");
          if (ok) waiter.res(raw);
          else waiter.rej(Object.assign(new Error(line || "IMAP command failed"), { statusCode: 502 }));
        }
      });
    });
    sock.on("error", fail);
    sock.on("end", function () {
      if (!settled) fail(new Error("IMAP closed"));
    });

    function greeting() {
      if (greeted) return Promise.resolve();
      return new Promise(function (res, rej) {
        greetRes = res;
        setTimeout(function () {
          if (!greeted) rej(new Error("No IMAP greeting"));
        }, 6000);
      });
    }

    (async function run() {
      await greeting();
      await send("LOGIN " + quotedImap(user) + " " + quotedImap(pass));
      await send("SELECT " + quotedImap(box));
      const search = await send('SEARCH SINCE ' + imapSince(opts.sinceDays || 21));
      const ids = (search.match(/\* SEARCH[^\n]*/i) || [""])[0]
        .replace(/^\* SEARCH\s*/i, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(-MAX_MESSAGES);
      let raw = "";
      if (ids.length) {
        raw = await send(
          "FETCH " +
            ids.join(",") +
            " (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT])"
        );
      }
      try {
        await send("LOGOUT");
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      settled = true;
      try {
        sock.end();
      } catch {
        /* ignore */
      }
      resolve(parseImapFetch(raw));
    })().catch(fail);
  });
}

function statusPayload() {
  const configured = imapConfigured();
  const missing = missingImapEnv();
  const reason = configured ? "" : "Inbox not connected yet — ask Jeffrey";
  return {
    configured,
    mailbox: mailboxAddress(),
    host: process.env.HR_APPLICANTS_IMAP_HOST || DEFAULT_HOST,
    missing,
    reason,
    code: configured ? "" : "imap_unconfigured",
    hint: configured
      ? "Signed-in HR can pull recent application emails from this inbox into Pipeline."
      : reason +
        ". Set " +
        (missing.join(" and ") || "HR_APPLICANTS_IMAP_USER and HR_APPLICANTS_IMAP_PASS") +
        " (Gmail app password, not the account password) on site corcondev-hr, Functions scope, then redeploy. Optional: HR_APPLICANTS_IMAP_HOST (imap.gmail.com), HR_APPLICANTS_IMAP_PORT (993), HR_APPLICANTS_IMAP_MAILBOX (INBOX). Until then, paste JSON or use Import from the mailbox.",
  };
}

module.exports = {
  DEFAULT_MAILBOX,
  mailboxAddress,
  imapConfigured,
  missingImapEnv,
  decodeMimeWord,
  parseFrom,
  guessPosition,
  guessMobile,
  applicantFromEmail,
  parseImapFetch,
  imapSince,
  fetchMailboxEmails,
  statusPayload,
};
