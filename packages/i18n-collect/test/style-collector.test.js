const assert = require('assert')
const test = require('node:test')
const { collectStyle } = require('../myloader/collect-style')

test('collects directly authored style strings and ignores computed tokens', () => {
  const source = '.a { content: /* i18n-key: badge.direct */ "\\76F4\\63A5" "计算"; }'
  const commentStart = source.indexOf('/*')
  const firstQuote = source.indexOf('"')
  const firstQuoteEnd = source.indexOf('"', firstQuote + 1)
  const secondQuote = source.indexOf('"', firstQuoteEnd + 1)

  const result = collectStyle({
    source,
    projectPath: 'src/theme.scss',
    style: {
      comments: [],
      declarations: [{
        property: 'content',
        start: source.indexOf('content'),
        value: {
          start: source.indexOf(':') + 1,
          end: source.indexOf(';'),
          comments: [{
            start: commentStart,
            end: source.indexOf('*/') + 2,
            text: ' i18n-key: badge.direct '
          }],
          tokens: [{
            type: 'static-string',
            quoteStart: firstQuote,
            start: firstQuote + 1,
            end: firstQuoteEnd
          }, {
            type: 'computed',
            quoteStart: secondQuote,
            start: secondQuote + 1,
            end: source.indexOf('"', secondQuote + 1)
          }]
        }
      }]
    }
  })

  assert.deepStrictEqual(result, {
    entries: [{
      value: '直接',
      key: 'badge.direct',
      locations: [{
        path: 'src/theme.scss',
        kind: 'css-generated-content',
        start: { line: 1, column: firstQuote + 1 },
        end: { line: 1, column: firstQuoteEnd }
      }]
    }],
    warnings: []
  })
})
