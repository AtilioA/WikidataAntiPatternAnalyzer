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

let parseResultValue = (result) => {
   return result['object']['value'].match(/Q\w+/)[0];
}

let checkForAntipattern = async (entity, statement) => {
    // console.log(statement);
    const { newEntity, newProperty } = statement;

    const queryString = buildQueryString(entity, "P31");
    console.log(queryString);

    const response = await getRequestEndpoint(queryString);
    console.log(response);
    const results = response['results']['bindings'];

    let QIDs = results.map(parseResultValue);
    console.log(`${entity} is involved in AP1 with ${QIDs.length} entities.`)

}

checkForAntipattern("Q24609026", { newEntity: "Q34770", newProperty: "P279" });
