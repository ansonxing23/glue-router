const Koa = require('koa');
const rp = require('request-promise');
const koaBody = require('koa-body');
const parse = require('url-parse');
const omit = require('lodash/omit')
const get = require('lodash/get')
const set = require('lodash/set')
const isArray = require('lodash/isArray')
const fs = require('fs')
const program = require('commander');

let setting = {}
program
    .version('0.1.0')
    .option('-i, --input [value]', 'Add setting file', function (arg) {
        const data = fs.readFileSync(arg, 'utf8');
        setting = JSON.parse(data)
    })
    .parse(process.argv);

const app = new Koa();
app.use(koaBody({ multipart: true }));

searchRoute = (url) => {
    const parsed = parse(url)
    return setting.routes.filter(item => parsed.pathname.indexOf(item.frontend) > -1)[0]
}

searchBackend = (route, url) => {
    const backendRef = !!route ? route.backendRef : 'default'
    const backend = setting.backends.filter(item => item.name === backendRef)[0]
    if (!!route) {
        return !!url ? url.replace(route.frontend, backend.url) : backend.url
    } else {
        return backend.url = url
    }
}

buildHeaders = (route, headers) => {
    const backendRef = !!route ? route.backendRef : 'default'
    const backend = setting.backends.filter(item => item.name === backendRef)[0]
    return omit(headers, backend.passthroughHeaders ? backend.passthroughHeaders.excludes : [])
}

const request = (method, url, headers, body) => {
    let opts = {
        method,
        url,
        headers: headers,
        json: true
    }
    if (!!headers['content-type'] && headers['content-type'].indexOf('multipart/form-data') > -1) {
        opts = Object.assign({}, opts, {
            formData: {
                data: {
                    value: fs.createReadStream(body.files.data.path),
                    options: {
                        filename: body.files.data.name,
                        contentType: body.files.data.type
                    }
                }
            }
        })
    } else {
        opts = Object.assign({}, opts, {
            body
        })
    }
    return rp(opts)
}

// response
app.use(async ctx => {
    try {
        const req = ctx.request
        const route = searchRoute(req.url)
        const headers = buildHeaders(route, ctx.header)
        const body = ctx.request.body
        const backendUrl = searchBackend(route, req.url)

        let data = await request(req.method, backendUrl, headers, body)
        if (!!route.rules) {
            const isArr = isArray(data)
            async function requestData(rule) {
                let ids = []
                if (isArr) {
                    ids = data.map(obj => get(obj, rule.src))
                } else {
                    ids = ids.concat(get(data, rule.src))
                }
                const subUrl = searchBackend(rule) + '/' + ids.join(',')
                const subHeaders = buildHeaders(rule, ctx.header)
                return request('GET', subUrl, subHeaders, {})
            }
            const promises = route.rules.map(requestData)
            const resps = await Promise.all(promises)

            route.rules.forEach((rule, idx) => {
                if (isArr) {
                    data = data.map((obj, j) => set(obj, rule.tgt, resps[idx][j]))
                } else {
                    data = set(data, rule.tgt, resps[idx])
                }
            })
            ctx.body = data
        } else {
            ctx.body = data
        }
    } catch (error) {
        ctx.body = error.response.body
    }
});

app.listen(3000, function () {
    console.log('Server start...');
});