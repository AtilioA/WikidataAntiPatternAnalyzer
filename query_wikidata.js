const BASE_URL = "https://query.wikidata.org/sparql?query="
const QUERY_TEMPLATE = `SELECT * WHERE { wd:Q150 wdt:P31 ?object . wd:Q150 wdt:P279+ ?object . }`
const headers = {
    Accept: "application/sparql-results+json"
}

const fetch = require('node-fetch');

let getRequestEndpoint = async () => {
    try {
        console.log(`\n REQUESTING ${BASE_URL + encodeURIComponent(QUERY_TEMPLATE)}...\n`)
        let request = await fetch(BASE_URL + encodeURIComponent(QUERY_TEMPLATE), { headers })

        if (request) {
            console.log(`\n REQUESTED. READING...\n`)
            let response = await request.json();
            console.log(`\nRESPONSE:`)
            console.log(response['results']['bindings'])
            return response;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

getRequestEndpoint()
