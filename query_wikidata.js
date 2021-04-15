const BASE_URL = "https://query.wikidata.org/sparql?query="
const QUERY_TEMPLATE = `SELECT * WHERE { wd:Q150 wdt:P31 ?object . wd:Q150 wdt:P279+ ?object . }`
const headers = {
    Accept: "application/sparql-results+json"
}

const fetch = require('node-fetch');

let buildQueryString = (queryEntity) => QUERY_TEMPLATE.replace(/Q150/gi, queryEntity)

let getRequestEndpoint = async () => {
    try {
        console.log(`REQUESTING ${BASE_URL + encodeURIComponent(QUERY_TEMPLATE)}...\n`)
        let request = await fetch(BASE_URL + encodeURIComponent(QUERY_TEMPLATE), { headers })

        if (request) {
            console.log(`REQUESTED. READING...\n`)
            let response = await request.json();
            console.log(`RESPONSE:`)
            console.log(response['results']['bindings'])
            return response;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

console.log(buildQueryString("Q2"))
getRequestEndpoint();
