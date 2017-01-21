/*! Adapted from esquery

Copyright (c) 2013, Joel Feenstra
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the ESQuery nor the names of its contributors may
      be used to endorse or promote products derived from this software without
      specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL JOEL FEENSTRA BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

{
  function strUnescape(s) {
    return s.replace(/\\(.)/g, function(match, ch) {
      switch(ch) {
        case 'a': return '\a';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'v': return '\v';
        default: return ch;
      }
    });
  }
}

start
  = _ ss:selectors _ { return ss.length === 1 ? ss[0] : { type: 'matches', selectors: ss }; }
  / _ { return void 0; }

_ = " "*
identifierName = i:[^ [\],():#!=><~+.]+ { return i.join(''); }
binaryOp
  = _ ">" _ { return 'child'; }
  / " " _ { return 'descendant'; }

selectors = s:selector ss:(_ "," _ selector)* {
  return [s].concat(ss.map(function (s) { return s[3]; }));
}

selector
  = a:sequence ops:(binaryOp sequence)* {
    return ops.reduce(function (memo, rhs) {
      return { type: rhs[0], left: memo, right: rhs[1] };
    }, a);
  }

sequence
  = subject:"!"? as:atom+ {
    var b = as.length === 1 ? as[0] : { type: 'compound', selectors: as };
    if(subject) b.subject = true;
    return b;
  }

atom
  = wildcard / identifier / attr / field

wildcard = a:"*" { return { type: 'wildcard', value: a }; }
identifier = "#"? i:identifierName { return { type: 'identifier', value: i }; }

attr
  = "[" _ v:attrValue _ "]" { return v; }
  attrOps = a:[><!]? "=" { return (a || '') + '='; } / [><]
  attrEqOps = a:"!"? "="  { return a + '='; }
  attrName = i:(identifierName / ".")+ { return i.join(''); }
  attrValue
    = name:attrName _ op:attrEqOps _ value:(type / regex) {
      return { type: 'attribute', name: name, operator: op, value: value };
    }
    / name:attrName _ op:attrOps _ value:(string / number / path) {
      return { type: 'attribute', name: name, operator: op, value: value };
    }
    / name:attrName { return { type: 'attribute', name: name }; }
    string
      = "\"" d:([^\\"] / a:"\\" b:. { return a + b; })* "\"" {
        return { type: 'literal', value: strUnescape(d.join('')) };
      }
      / "'" d:([^\\'] / a:"\\" b:. { return a + b; })* "'" {
        return { type: 'literal', value: strUnescape(d.join('')) };
      }
    number
      = a:([0-9]* ".")? b:[0-9]+ {
        return { type: 'literal', value: parseFloat((a ? a.join('') : '') + b.join('')) };
      }
    path = i:identifierName { return { type: 'literal', value: i }; }
    type = "type(" _ t:[^ )]+ _ ")" { return { type: 'type', value: t.join('') }; }
    regex = "/" d:[^/]+ "/" { return { type: 'regexp', value: new RegExp(d.join('')) }; }

field = "." i:identifierName is:("." identifierName)* {
  return { type: 'field', name: is.reduce(function(memo, p){ return memo + p[0] + p[1]; }, i)};
}
