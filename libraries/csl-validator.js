var CSLValidator = (function() {

    //to access URL parameters
    var uri;

    //required for highlighting in ace editor
    var Range;

    //keep track of source code highlighting, so we can remove prior highlighting
    //when selecting a different error
    var marker;

    var validateButton;

    //keep track of how much time validator.nu is taking
    var responseTimer;
    var responseMaxTime = 10000; //in milliseconds
    var responseStartTime;
    var responseEndTime;

    var init = function() {

        //Initialize URI.js
        uri = new URI();

        //Create range for Ace editor
        Range = ace.require("ace/range").Range;

        //Initialize Ladda buttons
        validateButton = Ladda.create(document.querySelector('#validate'));
        saveButton = Ladda.create(document.querySelector('#save'));
        saveButton.disable();
        submitButton = Ladda.create(document.querySelector('#submit'));
        submitButton.disable();

        //set schema-version if specified
        if (uri.hasQuery('version')) {
          var setSchemaVersion = uri.query(true)['version'];

          //http://stackoverflow.com/a/2248991/1712389
          $('#schema-version option').each(function() {
              if (this.value == setSchemaVersion) {
                  $("#schema-version").val(setSchemaVersion);
                  return false;
              }
          });
        }

        //run validation if URL parameters includes URL
        if (uri.hasQuery('url')) {
            var setURL = uri.query(true)['url'];
            $("#source-url").val(setURL);
            validate();
        }

        //update page for selected input method
        $("#source-method").change(function() {
            var sourceMethod = this.value;
            adaptToSourceMethod(sourceMethod);
        });

        //validate on button click
        $("#validate").click(validate);

        //save on button click
        $("#save").click(saveFile);

        //validate when pressing Enter in URL text field
        $('#source-url').keydown(function(event) {
            if (event.keyCode == 13) {
                event.preventDefault();
                validate();
            }
        });
    };

    var adaptToSourceMethod = function(sourceMethod) {
        var inputField = "";

        switch (sourceMethod) {
            case "url":
                inputField = '<input id="source-url" class="form-control source-input">';
                break;
            case "file-upload":
                inputField = '<div class="source-input form-control" style="display:inline;"><input style="display:inline;" id="source-file" type="file"></div>';
                break;
            case "textarea":
                inputField = '<textarea id="source-text" class="form-control source-input" rows="15"></textarea>';
                break;
        }

        $(".source-input").replaceWith(inputField);
    };

    function validate() {

        $("#tabs").tabs("enable");

        removeValidationResults();

        validateButton.start();

        $("#source-tab").click();

        responseStartTime = new Date();
        responseTimer = window.setTimeout(reportTimeOut, responseMaxTime);
        
        var cslVersion = $('#schema-version').val()
        if (cslVersion.indexOf("mlz") > -1) {
            var schemaURL = "https://raw.githubusercontent.com/fbennett/schema/v" + cslVersion + "/csl-mlz.rnc";
        } else {
            var schemaURL = "https://raw.githubusercontent.com/citation-style-language/schema/v" + cslVersion + "/csl.rnc";
        }
        //schemaURL += " " + "https://raw.githubusercontent.com/citation-style-language/schema/master/csl.sch";

        var sourceMethod = $('#source-method').val();

        switch (sourceMethod) {
            case "url":
                var documentURL = $('#source-url').val();

                uri.setSearch("url", documentURL);
                uri.setSearch("version", $('#schema-version').val());
                history.pushState({}, document.title, uri);

                //don't try validation on empty string
                if ($.trim(documentURL).length > 0) {
                    validateViaGET(schemaURL, documentURL);
                } else {
                    window.clearTimeout(responseTimer);
                    validateButton.stop();
                }

                break;
            case "file-upload":
                uri.search("");
                history.pushState({}, document.title, uri);

                var documentFile = $('#source-file').get(0).files[0];
                validateViaPOST(schemaURL, documentFile, sourceMethod);
                break;
            case "textarea":
                uri.search("");
                history.pushState({}, document.title, uri);

                var documentContent = $('#source-text').val();
                validateViaPOST(schemaURL, documentContent, sourceMethod);
                break;
        }
    }

    function validateViaGET(schemaURL, documentURL) {
        $.get("http://our.law.nagoya-u.ac.jp/validate/", {
                doc: documentURL,
                schema: schemaURL,
                parser: "xml",
                laxtype: "yes",
                level: "error",
                out: "json",
                showsource: "yes"
            })
            .done(function(data) {
                parseResponse(data);
            });
    }

    function validateViaPOST(schemaURL, documentContent, sourceMethod) {
        var formData = new FormData();
        formData.append("schema", schemaURL);
        formData.append("parser", "xml");
        formData.append("laxtype", "yes");
        formData.append("level", "error");
        formData.append("out", "json");
        formData.append("showsource", "yes");

        if (sourceMethod == "textarea") {
            formData.append("content", documentContent);
        } else {
            formData.append("file", documentContent);
        }

        $.ajax({
            type: "POST",
            url: "http://our.law.nagoya-u.ac.jp/validate/",
            data: formData,
            success: function(data) {
                parseResponse(data);
            },
            processData: false,
            contentType: false
        });
    }

    function saveFile() {
        var xmlStr = editor.getSession().getValue();
        var fileName = "SomeFileName.txt"
        m = xmlStr.match(/.*<id>.*\/(.*)<\/id>/);
        if (m) {
            fileName = m[1] + ".csl";
        }
        xmlStr = '<?xml version="1.0" encoding="utf-8"?>' + xmlStr;
        xmlStr = btoa(xmlStr);
        var a = document.createElement('a');
        var ev = document.createEvent("MouseEvents");
        a.href = "data:application/octet-stream;charset=utf-8;base64,"+xmlStr;
        a.download = fileName;
        ev.initMouseEvent("click", true, false, self, 0, 0, 0, 0, 0,
                          false, false, false, false, 0, null);
        a.dispatchEvent(ev);
    }

    function parseResponse(data) {
        //console.log(JSON.stringify(data));

        window.clearTimeout(responseTimer);
        responseEndTime = new Date();
        console.log("Received response from http://our.law.nagoya-u.ac.jp/validate/ after " + (responseEndTime - responseStartTime) + "ms");

        removeValidationResults();

        var messages = data.messages;
        var errorCount = 0;
        var nonDocumentError = "";
        for (var i = 0; i < messages.length; i++) {
            if (messages[i].type == "non-document-error") {
                nonDocumentError = messages[i].message;
            } else if (messages[i].type == "error") {
                errorCount += 1;

                var results = "";
                results += '<li class="inserted">';

                var range = "";
                var firstLine = "";
                var lineText = "";
                var lastLine = messages[i].lastLine;
                var firstColumn = messages[i].firstColumn;
                var lastColumn = messages[i].lastColumn;
                if (messages[i].hasOwnProperty('firstLine')) {
                    firstLine = messages[i].firstLine;
                    range = firstLine + "-" + lastLine;
                    lineText = "Lines " + range;
                } else {
                    firstLine = lastLine;
                    lineText = "Line " + lastLine;
                }
                sourceHighlightRange = firstLine + ',' + firstColumn + ',' + lastLine + ',' + lastColumn;
                results += '<a style="text-decoration:none;padding:0.25em;border-radius:0.5em;border:1px solid black;" href="#source-code" onclick="CSLValidator.moveToLine(event,' + sourceHighlightRange + ');">' + lineText + '</a>: ';

                results += messages[i].message;
                results += "</li>";
                $("#error-list").append(results);
                $("#error-" + errorCount).text(messages[i].extract);
            }
        }

        if (nonDocumentError !== "") {
            $("#alert").append('<div class="inserted alert alert-warning" role="alert">Validation failed: ' + nonDocumentError + '</div>');
        } else if (errorCount === 0) {
            $("#tabs").tabs("disable", "#errors");
            $("#alert").append('<div class="inserted alert alert-success" role="alert">Good job! No errors found.</br><small>Interested in contributing your style or locale file? See our <a href="https://github.com/citation-style-language/styles/blob/master/CONTRIBUTING.md">instructions</a>.</small></div>');
        } else if (errorCount > 0) {
            if (errorCount == 1) {
                $("#alert").append('<div class="inserted alert alert-danger" role="alert">Oops, I found 1 error.</div>');
            } else {
                $("#alert").append('<div class="inserted alert alert-danger" role="alert">Oops, I found ' + errorCount + ' errors.</div>');
            }
            $("#alert > div.alert-danger").append('</br><small>If you have trouble understanding the error messages below, start by reading the <a href="http://citationstyles.org/downloads/specification.html">CSL specification</a> and the <a href="http://citationstylist.org/docs/citeproc-js-csl.html">Juris-M Specification Supplement</a>.</small>');

            $("#errors").attr("class", "panel panel-warning");
            $("#errors").prepend('<div class="panel-heading inserted"><h4 class="panel-title">Errors <a href="#" rel="tooltip" class="glyphicon glyphicon-question-sign" data-toggle="tooltip" data-placement="auto left" title="Click the link next to an error description to highlight the relevant lines in the Source window below"></a></h4></div>');
            $('[data-toggle="tooltip"]').tooltip();
        }

        if (data.source.code.length > 0) {
            $("#source").append('<div class="panel-heading inserted"><h4 class="panel-title">Source</h4></div>');
            $("#source").append('<div id="source-code" class="panel-body inserted"></div>');
            $("#source").attr("class", "panel panel-primary");
            $("#source-code").text(data.source.code);

            window.editor = ace.edit("source-code");
            editor.setReadOnly(false);
            editor.getSession().setUseWrapMode(true);
            editor.setHighlightActiveLine(true);
            editor.renderer.$cursorLayer.element.style.opacity = 1;
            editor.setTheme("ace/theme/eclipse");
            editor.getSession().setMode("ace/mode/xml");
            editor.commands.addCommand({
                name: 'saveFile',
                bindKey: {
                    win: 'Ctrl-S',
                    mac: 'Command-S',
                    sender: 'editor|cli'
                },
                exec: function(env, args, request) {
                    saveFile();
                }
            });
        }
        
        validateButton.stop();
        saveButton.enable();
    }

    function moveToLine(event,firstLine, firstColumn, lastLine, lastColumn) {
        $("#source-tab").click();
        $("#error-banner").remove();
        var errorNode = $('<div id="error-banner" class="inserted" style="display:inline;margin-left:1em;background:#white;border-radius:0.5em;border:1px solid #aaaaaa;padding:0.33em;"><span style="font-weight:bold;">ERROR @ </span><span>').get(0);
        var infoNode = event.target.parentNode.cloneNode(true);
        lineNumber = infoNode.firstChild;
        lineNumber.removeAttribute('onclick');
        lineNumber.setAttribute('style', 'color:white;font-weight:bold;text-size:smaller;border:none;');
        errorNode.appendChild(infoNode.firstChild);
        errorNode.appendChild(infoNode.lastChild);
        $("#source h4.panel-title").attr('style', 'display:inline;').after(errorNode);

        editor.scrollToLine(firstLine, true, true, function() {});
        editor.gotoLine(firstLine, 0, false);
        //alert(firstLine + "," + firstColumn + "," + lastLine + "," + lastColumn);
        sourceHighlightRange = new Range(firstLine - 1, firstColumn - 1, lastLine - 1, lastColumn);
        editor.session.removeMarker(marker);
        marker = editor.session.addMarker(sourceHighlightRange, "ace_selection", "text");
    }

    function removeValidationResults() {
        $(".inserted").remove();
        $("#errors").removeAttr("class");
        $("#source").removeAttr("class");
    }

    function reportTimeOut() {
        validateButton.stop();
        console.log("Call to http://our.law.nagoya-u.ac.jp/validate/ timed out after " + responseMaxTime + "ms.");
        $("#alert").append('<div class="inserted alert alert-warning" role="alert">Validation is taking longer than expected! (more than ' + responseMaxTime/1000 + ' seconds)</div>');
        $("#alert > div.alert-warning").append('</br><small>This typically happens if the <a href="http://our.law.nagoya-u.ac.jp/validate/">Nu HTML Checker</a> website is down, but maybe you get lucky if you wait a little longer.</small>');
    }

    return {
        init: init,
        moveToLine: moveToLine
    };
}());
