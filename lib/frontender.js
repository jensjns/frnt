var request = require("request");
var cache = require('./cache');

exports.init = function(options) {

    options = options || {};
    options.process = typeof options.process == "function" ? options.process : function(data, next) { next(null, data); };

    function middleware(req, res, next) {

        if (typeof options.passthrough == "function" && options.passthrough(req) == true){
            var proxyRequestFn = request[req.method.toLowerCase()];
            proxyRequestFn(options.proxyUrl + req.path).pipe(res);
            return;
        }

        if (typeof options.firstPackage === 'string') {

            res.setHeader('content-type', "text/html");

            var data = cache.get(req.path).value;
            data = data || {};
            var layout = data.layout;
            data.layout = false;

            res.render(options.firstPackage, data, function(err, html) {
                data.layout = layout;
                res.write(html);
                renderPage(req, res, options);
            });

        } else {

            renderPage(req, res, options);

        }

    };

    return middleware;

};

function renderPage(req, res, options) {


    var proxyRequestFn = request[req.method.toLowerCase()];

    var internalUrl = options.proxyUrl + req.path;

    var cachedData = cache.get(req.path);
    var rendered = false;

    if (cachedData.value && options.skipCache != true) {
        rendered = true;
        render(options, res, cachedData.value);
    }

    if (cachedData.outdated || options.skipCache == true) {

        proxyRequestFn(options.proxyUrl + req.path, function(err, proxyRes, body) {

            if (err != null){
                res.write(err.message);
                res.end();
                return;
            }

            if (typeof options.filter == "function") {
                body = options.filter(body.toString());
            }

            // generic error check
            if (proxyRes.headers['content-type'] != "application/json"){
                res.write(proxyRes.statusCode.toString());
                res.write("error");
                res.write(body);
                res.end();
                console.log("ERR", proxyRes.statusCode, body.toString());
                return;
            }


            var data = {};

            try {
                data = JSON.parse(body.toString());
            } catch (err) {
                var errString = "ERR - Malformed JSON from upstream";
                console.log(errString, err, body.toString());
                send_500_error({ message : errString, err : err, body : body.toString()}, res);
                return;
            }


            options.process(data, function(err, data) {

                if (typeof data.template == "string") {
                    if (options.layout === false) {
                        data.layout = false;
                    }
                }


                if (!rendered) {
                    switch(proxyRes.statusCode){
                        case 200:
                            render(options, res, data);
                            cache.set(req.path, data);
                            break;
                        case 404:
                            res.status = 404;
                            render(options, res, data);
                        break;
                        default:
                            send_500_error({err: "Unhandled status code in frnt"}, err);
                        break;
                    }
                }
            });
        });

    }
}

function send_500_error(err, res){
    res.status = 500;
    console.log(err);
    res.write(JSON.stringify(err));
    res.end();
}

function render(options, res, data) {
    if( typeof options.render == 'function' ) {
        options.render(options, res, data);
    }
    else {
        res.render(data.template, data, function(err, html) {
            if (err) {
                // failed to render html
                send_500_error({err : err, html : html, message : err.message}, res);
            } else {
                // all fine send the response
                res.write(html);
                res.end();
            }
        });
    }
}
