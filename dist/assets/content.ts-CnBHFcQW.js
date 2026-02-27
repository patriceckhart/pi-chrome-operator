(function(){chrome.runtime.onMessage.addListener((e,t,n)=>{if(e?.type==="EXECUTE_ACTION")return g(e.action).then(o=>n({ok:!0,result:o})).catch(o=>n({ok:!1,error:String(o)})),!0;if(e?.type==="GET_PAGE_CONTEXT"){const o=f();return n({ok:!0,context:o}),!0}});function m(e,t){return new Promise((n,o)=>{chrome.runtime.sendMessage({type:"EXECUTE_IN_PAGE_WORLD",fn:e,args:t},i=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):i?.ok?n(i.result):o(new Error(i?.error||"Page world execution failed"))})})}async function p(e,t){try{return await m(`
      function(args) {
        var selector = args.selector;
        var text = args.text;

        // Helper: safely set value on a Monaco editor instance
        function safeSetValue(editor) {
          if (!editor) return false;
          try {
            var model = editor.getModel ? editor.getModel() : null;
            if (model) {
              // Use pushEditOperations for a clean edit that preserves the editor
              var fullRange = model.getFullModelRange();
              model.pushEditOperations(
                [],
                [{
                  range: fullRange,
                  text: text
                }],
                function() { return null; }
              );
              return true;
            }
            // Fallback to setValue on the editor instance itself
            if (editor.setValue) {
              editor.setValue(text);
              return true;
            }
          } catch(e) {}
          return false;
        }

        // Helper: find editor instance that contains the target element
        function findEditorForElement(editors, target) {
          if (!editors || !target) return null;
          for (var i = 0; i < editors.length; i++) {
            var container = null;
            try { container = editors[i].getContainerDomNode(); } catch(e) {}
            if (!container) {
              try { container = editors[i].getDomNode(); } catch(e) {}
            }
            if (container && (container === target || container.contains(target) || target.contains(container))) {
              return editors[i];
            }
            // Also check parent chain - selector might point to a child of the editor
            var parent = target.parentElement;
            while (parent) {
              if (parent === container) return editors[i];
              parent = parent.parentElement;
            }
          }
          return null;
        }

        var target = document.querySelector(selector);
        // Also try to find the .monaco-editor container if selector doesn't point to it
        var monacoEl = target ? (target.closest(".monaco-editor") || target.querySelector(".monaco-editor")) : null;
        if (!monacoEl) monacoEl = document.querySelector(".monaco-editor");

        // Method 1: window.monaco.editor.getEditors() (Monaco >= 0.21)
        if (window.monaco && window.monaco.editor && window.monaco.editor.getEditors) {
          var editors = window.monaco.editor.getEditors();
          if (editors && editors.length > 0) {
            var matched = findEditorForElement(editors, target || monacoEl);
            if (matched) return safeSetValue(matched);
            if (editors.length === 1) return safeSetValue(editors[0]);
          }
        }

        // Method 2: AMD require - many Monaco deployments use this
        if (typeof require === "function") {
          var modules = [
            "vs/editor/editor.main",
            "vs/editor/editor.api",
            "monaco-editor"
          ];
          for (var m = 0; m < modules.length; m++) {
            try {
              var mod = require(modules[m]);
              if (mod && mod.editor && mod.editor.getEditors) {
                var eds = mod.editor.getEditors();
                if (eds && eds.length > 0) {
                  var matched2 = findEditorForElement(eds, target || monacoEl);
                  if (matched2) return safeSetValue(matched2);
                  if (eds.length === 1) return safeSetValue(eds[0]);
                }
              }
            } catch(e) {}
          }
        }

        // Method 3: look for editor instances attached to DOM nodes
        var monacoEls = document.querySelectorAll(".monaco-editor");
        for (var j = 0; j < monacoEls.length; j++) {
          var el = monacoEls[j];
          var instance = el.__monacoEditor || el._editor || el.editor;
          if (instance && (instance.getModel || instance.setValue)) {
            return safeSetValue(instance);
          }
        }

        // Method 4: last resort - find model via getModels and use pushEditOperations
        if (window.monaco && window.monaco.editor && window.monaco.editor.getModels) {
          var models = window.monaco.editor.getModels();
          if (models && models.length > 0) {
            try {
              var model = models[0];
              var fullRange = model.getFullModelRange();
              model.pushEditOperations(
                [],
                [{ range: fullRange, text: text }],
                function() { return null; }
              );
              return true;
            } catch(e) {
              // Very last resort: direct setValue on model
              try {
                models[0].setValue(text);
                return true;
              } catch(e2) {}
            }
          }
        }

        return false;
      }
    `,{selector:e,text:t})}catch{return!1}}async function y(e,t){try{return await m(`
      function(args) {
        var selector = args.selector;
        var text = args.text;

        // CKEditor 5: instance on DOM element
        var editable = document.querySelector(".ck-editor__editable");
        if (editable && editable.ckeditorInstance) {
          editable.ckeditorInstance.setData(text);
          return true;
        }

        // CKEditor 4: global CKEDITOR
        if (window.CKEDITOR && window.CKEDITOR.instances) {
          var keys = Object.keys(window.CKEDITOR.instances);
          if (keys.length > 0) {
            window.CKEDITOR.instances[keys[0]].setData(text);
            return true;
          }
        }

        return false;
      }
    `,{selector:e,text:t})}catch{return!1}}async function h(e){try{return await m(`
      function(args) {
        if (window.tinymce && window.tinymce.activeEditor) {
          window.tinymce.activeEditor.setContent(args.text);
          return true;
        }
        return false;
      }
    `,{text:e})}catch{return!1}}function f(){const e=Array.from(document.querySelectorAll("input:not([type=hidden]), textarea, select")).slice(0,50).map((r,c)=>({selector:u(r),type:r.tagName==="SELECT"?"select":r.type||"text",name:r.name||"",placeholder:r.placeholder||"",value:r.value||""})),t=Array.from(document.querySelectorAll("[contenteditable=true], [contenteditable=''], .monaco-editor, .ck-editor__editable, .ProseMirror, .tox-edit-area__iframe")).slice(0,20).map((r,c)=>({selector:u(r),type:"contenteditable",name:r.getAttribute("aria-label")||r.getAttribute("role")||"",placeholder:r.getAttribute("data-placeholder")||"",value:r.innerText?.slice(0,200)||""})),n=[...e,...t],o=Array.from(document.querySelectorAll("button, [role=button], input[type=submit], input[type=button], a.btn, a.button")).slice(0,30).map((r,c)=>({selector:u(r),text:r.innerText?.trim().slice(0,80)||r.getAttribute("aria-label")||""})),i=Array.from(document.querySelectorAll("a[href]")).slice(0,40).map(r=>({text:r.innerText?.trim().slice(0,60)||"",href:r.href})).filter(r=>r.text),a=document.body?.innerText?.slice(0,8e3)||"";return{url:location.href,title:document.title,text:a,links:i,inputs:n,buttons:o}}function u(e,t,n){if(e.id)return`#${CSS.escape(e.id)}`;const o=e.getAttribute("data-testid");if(o)return`[data-testid="${CSS.escape(o)}"]`;const i=e.getAttribute("name");if(i){const r=`${e.tagName.toLowerCase()}[name="${CSS.escape(i)}"]`;if(document.querySelectorAll(r).length===1)return r}const a=e.getAttribute("aria-label");if(a){const r=`[aria-label="${CSS.escape(a)}"]`;if(document.querySelectorAll(r).length===1)return r}return b(e)}function b(e){const t=[];let n=e;for(;n&&n!==document.body&&t.length<5;){let o=n.tagName.toLowerCase();if(n.id){t.unshift(`#${CSS.escape(n.id)}`);break}const i=n.parentElement;if(i){const a=Array.from(i.children).filter(r=>r.tagName===n.tagName);if(a.length>1){const r=a.indexOf(n)+1;o+=`:nth-of-type(${r})`}}t.unshift(o),n=i}return t.join(" > ")}function E(e){const t=e.closest(".monaco-editor")??document.querySelector(".monaco-editor");if(t||e.classList.contains("monaco-editor")){const c=t??e,l=c.querySelector("textarea.inputarea");return l?{type:"monaco",target:l}:{type:"monaco",target:c}}const n=e.closest(".ck-editor__editable")??e.querySelector(".ck-editor__editable");if(n)return{type:"ckeditor",target:n};const o=e.closest("[id^=cke_]");if(o){const c=o.querySelector("iframe");if(c?.contentDocument?.body)return{type:"ckeditor",target:c.contentDocument.body}}const i=e.closest(".ProseMirror");if(i)return{type:"prosemirror",target:i};const a=e.closest(".tox-edit-area");if(a){const c=a.querySelector("iframe");if(c?.contentDocument?.body)return{type:"tinymce",target:c.contentDocument.body}}if(e.isContentEditable||e.getAttribute("contenteditable")==="true"||e.getAttribute("contenteditable")==="")return{type:"contenteditable",target:e};let r=e.parentElement;for(;r&&r!==document.body;){if(r.isContentEditable)return{type:"contenteditable",target:r};r=r.parentElement}return{type:"native",target:e}}async function w(e,t,n){if(e.focus(),await s(100),e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)e.select();else{const o=window.getSelection();if(o&&e.childNodes.length>0){const i=document.createRange();i.selectNodeContents(e),o.removeAllRanges(),o.addRange(i)}}if(await s(50),document.execCommand("delete",!1),await s(50),n)for(const o of t){const i=new InputEvent("beforeinput",{inputType:"insertText",data:o,bubbles:!0,cancelable:!0,composed:!0});if(!!e.dispatchEvent(i)&&!document.execCommand("insertText",!1,o)){const r=new InputEvent("input",{inputType:"insertText",data:o,bubbles:!0,composed:!0});e.dispatchEvent(r)}await s(15+Math.random()*25)}else{const o=new InputEvent("beforeinput",{inputType:"insertText",data:t,bubbles:!0,cancelable:!0,composed:!0});e.dispatchEvent(o),document.execCommand("insertText",!1,t)||(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement?(e.value=t,e.dispatchEvent(new Event("input",{bubbles:!0})),e.dispatchEvent(new Event("change",{bubbles:!0}))):(e.textContent=t,e.dispatchEvent(new InputEvent("input",{inputType:"insertText",data:t,bubbles:!0,composed:!0}))))}}async function g(e){switch(e.type){case"navigate":return location.href=e.url,{navigated:e.url};case"click":{let t=null;if(e.selector&&(t=document.querySelector(e.selector)),!t&&e.text&&(t=v(e.text)),!t)throw new Error(`Element not found: ${e.selector||e.text}`);return t.scrollIntoView({behavior:"smooth",block:"center"}),await s(300),t.click(),{clicked:e.selector||e.text}}case"type":{const t=document.querySelector(e.selector);if(!t)throw new Error(`Input not found: ${e.selector}`);t.scrollIntoView({behavior:"smooth",block:"center"}),await s(200);const n=E(t);if(n.type==="monaco"&&await p(e.selector,e.text))return e.submit&&await d(t,n.target),{typed:e.selector,text:e.text,method:"api",editor:"monaco"};if(n.type==="ckeditor"&&await y(e.selector,e.text))return e.submit&&await d(t,n.target),{typed:e.selector,text:e.text,method:"api",editor:"ckeditor"};if(n.type==="tinymce"&&await h(e.text))return e.submit&&await d(t,n.target),{typed:e.selector,text:e.text,method:"api",editor:"tinymce"};const o=e.text.length<500;return await w(n.target,e.text,o),e.submit&&await d(t,n.target),{typed:e.selector,text:e.text,method:"keyboard",editor:n.type}}case"select":{const t=document.querySelector(e.selector);if(!t)throw new Error(`Select not found: ${e.selector}`);return t.value=e.value,t.dispatchEvent(new Event("change",{bubbles:!0})),{selected:e.value}}case"wait":return await s(e.ms),{waited:e.ms};case"scroll":{const t=e.amount??400;return window.scrollBy({top:e.direction==="down"?t:-t,behavior:"smooth"}),await s(500),{scrolled:e.direction}}case"extract":return e.selector?Array.from(document.querySelectorAll(e.selector)).map(n=>n.innerText?.trim()).filter(Boolean):document.body?.innerText?.slice(0,1e4);case"screenshot":return f();default:return{noop:!0}}}async function d(e,t){await s(200);const n=e.closest("form");n?n.requestSubmit():(t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,bubbles:!0,composed:!0})),t.dispatchEvent(new KeyboardEvent("keypress",{key:"Enter",code:"Enter",keyCode:13,bubbles:!0,composed:!0})),t.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",keyCode:13,bubbles:!0,composed:!0})))}function v(e){const t=e.toLowerCase();return[...Array.from(document.querySelectorAll("button, a, [role=button]")),...Array.from(document.querySelectorAll("li, span, div, h1, h2, h3, h4, h5, h6, p"))].find(o=>o.innerText?.trim().toLowerCase().includes(t))??null}function s(e){return new Promise(t=>setTimeout(t,e))}
})()
