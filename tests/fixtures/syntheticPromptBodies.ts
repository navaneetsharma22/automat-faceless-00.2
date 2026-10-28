const hindi = "\u0928\u092e\u0938\u094d\u0924\u0947";
const escapedQuote = String.fromCharCode(92, 34);
const escapedSlash = String.fromCharCode(92, 92);
const sharedFields = [
  '  "fixture": "SYNTHETIC ONLY — not a user draft",',
  '  "decimal_values": [0.125, -1.75, 3.14159],',
  `  "quote_and_slash": "${escapedQuote}quoted${escapedQuote} and ${escapedSlash} backslash",`,
];
const repeatedSegment = `${hindi} ${escapedQuote}quoted${escapedQuote} ${escapedSlash} path / decimal 0.875 \u{1f3ac} `;

function makeBody(repetitions: number, newline: "\n" | "\r\n"): string {
  return [
    "{",
    ...sharedFields,
    `  "text": "${repeatedSegment.repeat(repetitions)}"`,
    "}",
  ].join(newline);
}

export const syntheticPromptBodies = {
  lf: makeBody(350, "\n"),
  crlf: makeBody(350, "\r\n"),
  long: makeBody(28_000, "\n"),
};
