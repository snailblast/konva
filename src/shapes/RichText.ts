import { Util } from '../Util';
// import { Context } from '../Context'
import { Factory } from '../Factory';
import { Shape, ShapeConfig } from '../Shape';
import { getNumberValidator, getStringValidator, getNumberOrAutoValidator, getBooleanValidator } from '../Validators';
import { _registerNode } from '../Global';

import { GetSet } from '../types';

export interface RichTextConfig extends ShapeConfig {
  text?: string;
  textStyles?: TextStyle[]
  align?: string;
  verticalAlign?: string;
  padding?: number;
  lineHeight?: number;
  letterSpacing?: number;
  wrap?: string;
  ellipsis?: boolean;
}

// constants
var AUTO = 'auto',
  //CANVAS = 'canvas',
  CENTER = 'center',
  JUSTIFY = 'justify',
  CHANGE_KONVA = 'Change.konva',
  CONTEXT_2D = '2d',
  DASH = '-',
  LEFT = 'left',
  RICH_TEXT = 'richtext',
  RICH_TEXT_UPPER = 'RichText',
  TOP = 'top',
  BOTTOM = 'bottom',
  MIDDLE = 'middle',
  NORMAL = 'normal',
  PX_SPACE = 'px ',
  SPACE = ' ',
  RIGHT = 'right',
  WORD = 'word',
  CHAR = 'char',
  NONE = 'none',
  ELLIPSIS = '…',
  ATTR_CHANGE_LIST = [
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontVariant',
    'padding',
    'align',
    'verticalAlign',
    'lineHeight',
    'text',
    'width',
    'height',
    'wrap',
    'ellipsis',
    'letterSpacing',
  ],
  // cached variables
  attrChangeListLen = ATTR_CHANGE_LIST.length;

function normalizeFontFamily(fontFamily: string) {
  return fontFamily
    .split(',')
    .map((family) => {
      family = family.trim();
      const hasSpace = family.indexOf(' ') >= 0;
      const hasQuotes = family.indexOf('"') >= 0 || family.indexOf("'") >= 0;
      if (hasSpace && !hasQuotes) {
        family = `"${family}"`;
      }
      return family;
    })
    .join(', ');
}

var dummyContext;
function getDummyContext() {
  if (dummyContext) {
    return dummyContext;
  }
  dummyContext = Util.createCanvasElement().getContext(CONTEXT_2D);
  return dummyContext;
}

function _fillFunc(context) {
  context.fillText(this.drawState.text, this.drawState.x, this.drawState.y);
}
function _strokeFunc(context) {
  context.strokeText(this.drawState.text, this.drawState.x, this.drawState.y, undefined);
}

export interface TextStyle {
  start: number // start position of the style
  end?: number // end position of the style, if undefined it means until the end
  fontFamily: string
  fontSize: number
  fontStyle: 'normal' | 'italic' | 'bold' | 'italic bold' | 'bold italic'
  fontVariant: 'normal' | 'small-caps'
  textDecoration: '' | 'underline' | 'line-through' | 'underline line-through'
  fill: string
  stroke: string,
  strokeWidth: number
}

type TextPart = {
  text: string
  width: number
  style: Omit<TextStyle, 'start' | 'end'>
}

function checkDefaultFill(config) {
  config = config || {};
  return config;
}



export class RichText extends Shape<RichTextConfig> {
  textLines: {
    width: number
    totalHeight: number
    parts: TextPart[]
  }[] = []
  linesWidth!: number
  linesHeight!: number

  // used when drawing
  drawState!: {
    x: number
    y: number
    text: string
  }

  constructor(config?: RichTextConfig) {
    super(checkDefaultFill(config));
    // update text data for certain attr changes
    for (const attr of [
      'padding', 'wrap', 'lineHeight', 'letterSpacing', 'textStyles', 'width', 'height', 'text'
    ]) {
      this.on(`${attr}Change.konva`, this.computeTextParts)
    }
    this.computeTextParts()
  }

  formatFont(part: Pick<TextPart, 'style'>) {
    return `${part.style.fontStyle} ${part.style.fontVariant} ${part.style.fontSize}px ${normalizeFontFamily(part.style.fontFamily)}`
  }

  measurePart(part: Omit<TextPart, 'width'>) {
    const context = getDummyContext()
    context.save()
    context.font = this.formatFont(part)
    const width = context.measureText(part.text).width
    context.restore()
    return width
  }

  computeTextParts() {
    this.textLines = []
    const lines = this.text().split('\n')
    const maxWidth = this.attrs.width
    const maxHeight = this.attrs.height
    const hasFixedWidth = maxWidth !== 'auto' && maxWidth !== undefined
    const hasFixedHeight = maxHeight !== 'auto' && maxHeight !== undefined

    const shouldWrap = this.wrap() !== 'none'
    const wrapAtWord = this.wrap() !== 'char' && shouldWrap
    const shouldAddEllipsis = this.ellipsis()
    const styles = this.textStyles()
    const ellipsis = '…'
    const additionalWidth = shouldAddEllipsis ? this.measurePart({ text: ellipsis, style: styles[styles.length - 1] }) : 0;

    const stylesByChar = Array.from(this.text()).map((char, index) => {
      return {
        char,
        style: styles.find((style) => index >= style.start && (typeof style.end === 'undefined' || style.end >= index))!
      }
    })
    const findParts = (start: number, end: number) => {
      // find matching characters
      const chars = stylesByChar.filter(x => x.char != '\n').slice(start, end)
      // group them by style
      const parts: TextPart[] = []
      for (const char of chars) {
        const similarGroupIndex = parts.findIndex((part) => part.style === char.style)
        if (similarGroupIndex === -1) {
          parts.push({ text: char.char, width: 0, style: char.style })
          continue
        }
        parts[similarGroupIndex].text += char.char
      }
      return parts
    }
    const measureSubstring = (start: number, end: number) => {
      return measureParts(findParts(start, end))
    }
    const measureParts = (parts: TextPart[]) => {
      return parts.reduce((size, part) => {
        part.width = this.measurePart(part)
        return size + part.width + part.text.length * this.letterSpacing()
      }, 0)
    }
    const measureHeightParts = (parts: TextPart[], defaultHeight: number) => {
      if (parts.length == 0) {
        return defaultHeight
      }
      return Math.max(...parts.map((part) => {
        return part.style.fontSize * this.lineHeight()
      }))
    }
    const addLine = (width: number, height: number, parts: TextPart[]) => {
      // if element height is fixed, abort if adding one more line would overflow
      // so we don't add this line, the loop will be broken anyway
      if (hasFixedHeight && (currentHeight + height) > maxHeight) {
        return
      }
      this.textLines.push({
        width,
        parts: parts.map((part) => {
          // compute size if not already computed during part creation
          part.width = part.width === 0 ? this.measurePart(part) + part.text.length * this.letterSpacing() : part.width
          return part
        }),
        totalHeight: height
      })
    }

    let currentHeight = 0
    let charCount = 0
    let previousLineHeight = 12;
    for (let line of lines) {
      let lineWidth = measureSubstring(charCount, charCount + line.length)
      let lineHeight: number

      if (hasFixedWidth && lineWidth > maxWidth) {
        /*
         * if width is fixed and line does not fit entirely
         * break the line into multiple fitting lines
         */
        let cursor = 0
        while (line.length > 0) {
          /*
           * use binary search to find the longest substring that
           * that would fit in the specified width
           */
          var low = 0,
            high = line.length,
            match = '',
            matchWidth = 0
          while (low < high) {
            var mid = (low + high) >>> 1,
              substr = line.slice(0, mid + 1),
              substrWidth = measureSubstring(charCount + cursor, charCount + cursor + mid + 1) + additionalWidth
            if (substrWidth <= maxWidth) {
              low = mid + 1
              match = substr
              matchWidth = substrWidth
            } else {
              high = mid
            }
          }
          /*
            * 'low' is now the index of the substring end
            * 'match' is the substring
            * 'matchWidth' is the substring width in px
            */
          if (match) {
            // a fitting substring was found
            if (wrapAtWord) {
              // try to find a space or dash where wrapping could be done
              let wrapIndex: number
              var nextChar = line[match.length]
              var nextIsSpaceOrDash = nextChar === ' ' || nextChar === '-'
              if (nextIsSpaceOrDash && matchWidth <= maxWidth) {
                wrapIndex = match.length
              } else {
                wrapIndex = Math.max(match.lastIndexOf(' '), match.lastIndexOf('-')) + 1
              }
              if (wrapIndex > 0) {
                // re-cut the substring found at the space/dash position
                low = wrapIndex
                match = match.slice(0, low)
                matchWidth = measureSubstring(charCount + cursor, charCount + cursor + low)
              }
            }
            // match = match.trimRight()
            const parts = findParts(charCount + cursor, charCount + cursor + low)
            lineHeight = measureHeightParts(parts, previousLineHeight)
            addLine(measureParts(parts), lineHeight, parts)
            currentHeight += lineHeight
            if (
              !shouldWrap ||
              (hasFixedHeight && currentHeight + lineHeight > maxHeight)
            ) {
              const lastLine = this.textLines[this.textLines.length - 1]
              if (lastLine) {
                if (shouldAddEllipsis) {
                  const lastPart = lastLine.parts[lastLine.parts.length - 1]
                  const lastPartWidthWithEllipsis = this.measurePart({ ...lastPart, text: `${lastPart.text}${ellipsis}` })
                  const haveSpace = lastPartWidthWithEllipsis < maxWidth
                  if (!haveSpace) {
                    lastPart.text = lastPart.text.slice(0, lastPart.text.length - 3)
                  }
                  lastLine.parts.splice(lastLine.parts.length - 1, 1)
                  lastLine.parts.push({
                    ...lastPart,
                    width: lastPartWidthWithEllipsis,
                    text: `${lastPart.text}${ellipsis}`
                  })
                }
              }

              /*
                * stop wrapping if wrapping is disabled or if adding
                * one more line would overflow the fixed height
                */
              break
            }
            line = line.slice(low)
            cursor += low
            // line = line.trimLeft()
            if (line.length > 0) {
              // Check if the remaining text would fit on one line
              const parts = findParts(charCount + cursor, charCount + cursor + line.length)
              lineWidth = measureParts(parts)
              if (lineWidth <= maxWidth) {
                // if it does, add the line and break out of the loop
                const height = measureHeightParts(parts, previousLineHeight)
                addLine(lineWidth, height, parts)
                currentHeight += height
                charCount += cursor;
                break
              }
            }
          } else {
            // not even one character could fit in the element, abort
            break
          }
        }
      } else {
        const parts = findParts(charCount, charCount + line.length)
        lineHeight = measureHeightParts(parts, previousLineHeight)
        addLine(lineWidth, lineHeight, parts)
        currentHeight += lineHeight;
      }

      // if element height is fixed, abort if adding one more line would overflow
      // so we stop here to avoid processing useless lines
      if (hasFixedHeight && (currentHeight + lineHeight!) > maxHeight) {
        break
      }

      charCount += line.length
      previousLineHeight = lineHeight
    }

    this.linesHeight = this.textLines.reduce((size, line) => size + line.totalHeight, 0)
    this.linesWidth = Math.max(...this.textLines.map((line) => line.width, 0))
  }

  getHeight(): number {
    const isAuto = this.attrs.height === 'auto' || this.attrs.height === undefined
    if (!isAuto) {
      return this.attrs.height
    }
    return this.linesHeight + this.padding() * 2
  }

  getWidth(): number {
    const isAuto = this.attrs.width === 'auto' || this.attrs.width === undefined
    if (!isAuto) {
      return this.attrs.width
    }
    return this.linesWidth + this.padding() * 2
  }

  /**
   * @description This method is called when the shape should render
   * on canvas
   */
  _sceneFunc(context) {
    if (this.text().length === 0 || this.textLines.length === 0) {
      return
    }

    const totalWidth = this.getWidth()
    const totalHeight = this.getHeight()

    context.setAttr('textBaseline', 'middle')
    context.setAttr('textAlign', 'left')

    // handle vertical alignment
    const padding = this.padding()
    let alignY = 0
    if (this.verticalAlign() === 'middle') {
      alignY = (totalHeight - this.linesHeight - padding * 2) / 2;
    } else if (this.verticalAlign() === 'bottom') {
      alignY = totalHeight - this.linesHeight - padding * 2;
    }
    context.translate(padding, alignY + padding)
    if (this.textLines.length == 0) {
      return;
    }
    let y = this.textLines[0].totalHeight / 2
    let lineIndex = 0
    for (const line of this.textLines) {
      const isLastLine = lineIndex === this.textLines.length - 1
      let lineX = 0
      let lineY = 0
      context.save()

      // horizontal alignment
      if (this.align() === 'right') {
        lineX += totalWidth - line.width - padding * 2
      } else if (this.align() === 'center') {
        lineX += (totalWidth - line.width - padding * 2) / 2
      }

      for (const part of line.parts) {

        // style
        let textDecoration = part.style.textDecoration || ""
        if (textDecoration.includes('underline')) {
          context.save();
          context.beginPath()

          context.moveTo(
            lineX,
            y + lineY + Math.round(part.style.fontSize / 2)
          )
          const spacesNumber = part.text.split(' ').length - 1
          const oneWord = spacesNumber === 0
          const lineWidth =
            this.align() === 'justify' && isLastLine && !oneWord
              ? totalWidth - padding * 2
              : part.width
          context.lineTo(
            lineX + Math.round(lineWidth),
            y + lineY + Math.round(part.style.fontSize / 2)
          )

          // I have no idea what is real ratio
          // just /15 looks good enough
          context.lineWidth = part.style.fontSize / 15
          context.strokeStyle = part.style.fill
          context.stroke()
          context.restore()
        }
        if (textDecoration.includes('line-through')) {
          context.save()
          context.beginPath()
          context.moveTo(lineX, y + lineY)
          const spacesNumber = part.text.split(' ').length - 1
          const oneWord = spacesNumber === 0
          const lineWidth =
            this.align() === 'justify' && isLastLine && !oneWord
              ? totalWidth - padding * 2
              : part.width
          context.lineTo(
            lineX + Math.round(lineWidth),
            y + lineY
          )
          context.lineWidth = part.style.fontSize / 15
          context.strokeStyle = part.style.fill
          context.stroke()
          context.restore()
        }

        this.fill(part.style.fill)
        this.strokeWidth(part.style.strokeWidth);
        this.stroke(part.style.stroke)
        context.setAttr('font', this.formatFont(part))

        // text
        if (this.letterSpacing() !== 0 || this.align() === 'justify') {
          const spacesNumber = part.text.split(' ').length - 1
          var array = Array.from(part.text)
          for (let li = 0; li < array.length; li++) {
            const letter = array[li]
            // skip justify for the last line
            if (letter === ' ' && lineIndex !== this.textLines.length - 1 && this.align() === 'justify') {
              lineX += (totalWidth - padding * 2 - line.width) / spacesNumber;
            }
            this.drawState = {
              x: lineX,
              y: y + lineY,
              text: letter
            }
            context.fillStrokeShape(this)
            lineX += this.measurePart({ ...part, text: letter }) + this.letterSpacing()
          }
        } else {
          this.drawState = {
            x: lineX,
            y: y + lineY,
            text: part.text
          }
          context.fillStrokeShape(this)
          lineX += part.width + this.letterSpacing()
        }
      }

      context.restore()
      if (typeof this.textLines[lineIndex + 1] !== 'undefined') {
        y += (this.textLines[lineIndex].totalHeight / 2) + (this.textLines[lineIndex + 1].totalHeight / 2);
      }
      ++lineIndex
    }
  }

  _hitFunc(context) {
    context.beginPath()
    context.rect(0, 0, this.getWidth(), this.getHeight())
    context.closePath()
    context.fillStrokeShape(this)
  }

  // for text we can't disable stroke scaling
  // if we do, the result will be unexpected
  getStrokeScaleEnabled() {
    return true
  }

  align!: GetSet<'left' | 'center' | 'right' | 'justify', this>
  letterSpacing!: GetSet<number, this>
  verticalAlign!: GetSet<'top' | 'middle' | 'bottom', this>
  padding!: GetSet<number, this>
  lineHeight!: GetSet<number, this>
  text!: GetSet<string, this>
  textStyles!: GetSet<TextStyle[], this>
  wrap!: GetSet<'word' | 'char' | 'none', this>
  ellipsis!: GetSet<boolean, this>
}

RichText.prototype._fillFunc = _fillFunc;
RichText.prototype._strokeFunc = _strokeFunc;
RichText.prototype.className = RICH_TEXT_UPPER;
RichText.prototype._attrsAffectingSize = [
  'text',
  'fontSize',
  'padding',
  'wrap',
  'lineHeight',
  'letterSpacing',
  'textStyles',
];
_registerNode(RichText)

/**
 * get/set width of text area, which includes padding.
 * @name Konva.Text#width
 * @method
 * @param {Number} width
 * @returns {Number}
 * @example
 * // get width
 * var width = text.width();
 *
 * // set width
 * text.width(20);
 *
 * // set to auto
 * text.width('auto');
 * text.width() // will return calculated width, and not "auto"
 */
Factory.overWriteSetter(RichText, 'width', getNumberOrAutoValidator())

/**
 * get/set the height of the text area, which takes into account multi-line text, line heights, and padding.
 * @name Konva.Text#height
 * @method
 * @param {Number} height
 * @returns {Number}
 * @example
 * // get height
 * var height = text.height();
 *
 * // set height
 * text.height(20);
 *
 * // set to auto
 * text.height('auto');
 * text.height() // will return calculated height, and not "auto"
 */

Factory.overWriteSetter(RichText, 'height', getNumberOrAutoValidator());

/**
 * get/set padding
 * @name Konva.Text#padding
 * @method
 * @param {Number} padding
 * @returns {Number}
 * @example
 * // get padding
 * var padding = text.padding();
 *
 * // set padding to 10 pixels
 * text.padding(10);
 */

Factory.addGetterSetter(RichText, 'padding', 0, getNumberValidator())

/**
 * get/set horizontal align of text.  Can be 'left', 'center', 'right' or 'justify'
 * @name Konva.Text#align
 * @method
 * @param {String} align
 * @returns {String}
 * @example
 * // get text align
 * var align = text.align();
 *
 * // center text
 * text.align('center');
 *
 * // align text to right
 * text.align('right');
 */

Factory.addGetterSetter(RichText, 'align', LEFT)

/**
 * get/set vertical align of text.  Can be 'top', 'middle', 'bottom'.
 * @name Konva.Text#verticalAlign
 * @method
 * @param {String} verticalAlign
 * @returns {String}
 * @example
 * // get text vertical align
 * var verticalAlign = text.verticalAlign();
 *
 * // center text
 * text.verticalAlign('middle');
 */

Factory.addGetterSetter(RichText, 'verticalAlign', TOP)

/**
 * get/set line height.  The default is 1.
 * @name Konva.Text#lineHeight
 * @method
 * @param {Number} lineHeight
 * @returns {Number}
 * @example
 * // get line height
 * var lineHeight = text.lineHeight();
 *
 * // set the line height
 * text.lineHeight(2);
 */

Factory.addGetterSetter(RichText, 'lineHeight', 1, getNumberValidator())

/**
 * get/set wrap.  Can be "word", "char", or "none". Default is "word".
 * In "word" wrapping any word still can be wrapped if it can't be placed in the required width
 * without breaks.
 * @name Konva.Text#wrap
 * @method
 * @param {String} wrap
 * @returns {String}
 * @example
 * // get wrap
 * var wrap = text.wrap();
 *
 * // set wrap
 * text.wrap('word');
 */

Factory.addGetterSetter(RichText, 'wrap', WORD)

/**
 * get/set ellipsis. Can be true or false. Default is false. If ellipses is true,
 * Konva will add "..." at the end of the text if it doesn't have enough space to write characters.
 * That is possible only when you limit both width and height of the text
 * @name Konva.Text#ellipsis
 * @method
 * @param {Boolean} ellipsis
 * @returns {Boolean}
 * @example
 * // get ellipsis param, returns true or false
 * var ellipsis = text.ellipsis();
 *
 * // set ellipsis
 * text.ellipsis(true);
 */

Factory.addGetterSetter(RichText, 'ellipsis', false, getBooleanValidator())

/**
 * set letter spacing property. Default value is 0.
 * @name Konva.Text#letterSpacing
 * @method
 * @param {Number} letterSpacing
 */

Factory.addGetterSetter(RichText, 'letterSpacing', 0, getNumberValidator())

/**
 * get/set text
 * @name Konva.Text#text
 * @method
 * @param {String} text
 * @returns {String}
 * @example
 * // get text
 * var text = text.text();
 *
 * // set text
 * text.text('Hello world!');
 */

Factory.addGetterSetter(RichText, 'text', '', getStringValidator())

/**
 * get/set textStyles
 * @name Konva.Text#textStyles
 * @method
 * @param {TextStyle[]} textStyles
 * @returns {String}
 * @example
 * // set styles
 * text.textStyles([{ start: 0, fontFamily: 'Roboto' }]);
 */
const defaultStyle: TextStyle = {
  start: 0,
  fill: 'black',
  stroke: 'black',
  strokeWidth: 0,
  fontFamily: 'Arial',
  fontSize: 12,
  fontStyle: 'normal',
  fontVariant: 'normal',
  textDecoration: ''
}
Factory.addGetterSetter(RichText, 'textStyles', [defaultStyle])