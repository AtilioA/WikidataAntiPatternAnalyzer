const BASE_URL = "https://query.wikidata.org/sparql?query="
const QUERY_TEMPLATE = `SELECT * WHERE { wd:Q31 wdt:P31 ?object . wd:Q279 wdt:P279+ ?object . }`
const headers = {
    Accept: "application/sparql-results+json"
}


let buildQueryString = (queryEntity, queryString, replaceProperty) => {
    // console.log(replaceProperty)
    if (replaceProperty) {
        return queryString.replace(new RegExp(`Q${replaceProperty.slice(1)}`), queryEntity)
    } else {
        return queryString.replace(/Q\w+/gi, queryEntity)
    }
}

async function getRequestEndpointAP1(queryString) {
    try {
        // console.log(`REQUESTING ${BASE_URL + encodeURIComponent(queryString)}...\n`)
        let request = await fetch(BASE_URL + encodeURIComponent(queryString), { headers })

        if (request) {
            // console.log(`REQUESTED. READING...\n`)
            let response = await request.json();
            // console.log(`RESPONSE:`)
            return response;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function queryP279(subclass, superclass) {
    const P279_QUERY = `SELECT * WHERE { wd:${subclass} wdt:P279+ ${superclass} }`
    // console.log(P279_QUERY);

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P279_QUERY), { headers })

        if (request) {
            let response = await request.json();
            return response;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function isSubclass(subclass, superclass) {
    const P279_QUERY = `SELECT * WHERE { BIND( EXISTS { wd:${subclass} wdt:P279+ ${superclass} } as ?isSubclass ) }`
    // console.log(P279_QUERY);

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P279_QUERY), { headers })

        if (request) {
            let response = await request.json();
            return response['results']['bindings'][0]["isSubclass"]['value'];
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

async function isInstanceBulk(instance, entities) {
    let P31_QUERY = "SELECT * WHERE {\n"

    let nEntities = 0;
    for (let entity of entities) {
        P31_QUERY += `BIND( EXISTS { wd:${instance} wdt:P31 wd:${entity} } as ?isInstance${nEntities} ) .\n`
        nEntities++;
    }
    P31_QUERY += "}"

    // console.log(P31_QUERY);

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P31_QUERY), { headers })

        if (request) {
            let response = await request.json();
            const results = Object.values(response['results']['bindings'][0]);

            nEntities = 0;
            let areInstances = {true: [], false: []};
            for (let result of results) {
                areInstances[result['value']].push(entities[nEntities]);
                nEntities++;
            }

            return areInstances;
        }
    }
    catch(error) {
        throw new Error(error.message);
    }
}

let parseResultValues = (result) => {
    // console.log(result);
    // console.log(result['object']['value']);
    return result['object']['value'].match(/Q\w+/)[0];
}

async function checkForAntipattern(entity, statement) {
    // console.log(statement);
    let newEntity, newProperty;
    try {
        newEntity, newProperty = statement;
    }
    catch {
        console.log("New statement not found.")
    }

    // Test for existing AP1
    const queryString = buildQueryString(entity, QUERY_TEMPLATE);
    // console.log(queryString);

    const response = await getRequestEndpointAP1(queryString);
    // console.log(response);
    const results = response['results']['bindings'];

    let QIDsExistent = results.map(parseResultValues);
    console.log(`${entity} is involved in AP1 with ${QIDsExistent.length} entities: ${QIDsExistent}.`)

    // Test for new statement
    let QIDsNew = [];
    console.log("\nChecking possible new antipattern")
    if (newProperty == "P31") { // "entity is instance of newEntity" is true
        queryResult = await isSubclass(entity, 'wd:' + newEntity);
        console.log(queryResult, newEntity);
        if (queryResult == "true") { // is "entity is subclass of newEntity" also true?
            QIDsNew = newEntity; // then it is a violation
        }
    }
    else if (newProperty == "P279") { // "entity P279 newEntity" is true
        const superclassesQuery = await queryP279(newEntity, '?object'); // get all newEntity's superclasses
        const superclasses = superclassesQuery['results']['bindings'].map(parseResultValues);
        superclasses.push(newEntity);
        // console.log("Superclasses: ", superclasses);

        let areInstances = await isInstanceBulk(entity, superclasses); // is entity P31 newEntity or its superclasses also true?
        QIDsNew = areInstances['true'];
    }

    let antipatterns = {
        existent: QIDsExistent,
        new: QIDsNew
    }

    console.log(antipatterns);

    return antipatterns;
}

function getUrlVars() {
    var vars = {};
    var parts = window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
        vars[key] = value;
    });
    return vars;
}

async function handleParams() {
    params = getUrlVars();
    let antipatterns;

    const inputEntity = params["inputEntity"].toUpperCase();
    const inputNewProperty = params["inputNewProperty"].toUpperCase();
    const inputNewEntity = params["inputNewEntity"].toUpperCase();

    switch (params['analysis-option']) {
        case 'existent':
            antipatterns = await checkForAntipattern(inputEntity);
            break;
        case 'new':
            const statement = {
                newEntity: inputNewEntity,
                newProperty: inputNewProperty
            };
            antipatterns = await checkForAntipattern(inputEntity, statement);

            const comment = document.querySelector("#comment");

            let commentTitle = document.createElement('p');
            commentTitle.innerHTML = "New statement:"

            let newStatementQuery = document.createElement('code');
            newStatementQuery.innerHTML = `<i>wd:${inputEntity} wdt:${inputNewProperty} wd:${inputNewEntity}</i>`

            comment.appendChild(commentTitle);
            comment.appendChild(newStatementQuery);
            break;
        default:
            console.log("Unrecognized option")
    }
    if (antipatterns) {
        console.log(`OK: ${antipatterns['existent']};${antipatterns['new']}`)
        if (antipatterns['existent'].length > 0) {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "failure")

            resultItem.innerHTML = `<u>${inputEntity}</u> <b>is involved</b> in AP1 with <u>${antipatterns['existent']}</u>.`
            results.appendChild(resultItem);
        } else {
            const results = document.querySelector("#results");

            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "success")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>is not involved</b> in AP1.`

            results.appendChild(resultItem);
        }
        if (antipatterns['new'].length > 0) {
            const results = document.querySelector("#results");
            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "failure")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>would be involved</b> in AP1 with <u>${antipatterns['new']}</u> regarding the new statement.`
            results.appendChild(resultItem);
        } else if (params['analysis-option'] == 'new') {
            const results = document.querySelector("#results");
            let resultItem = document.createElement('p');
            resultItem.setAttribute('class', "success")
            resultItem.innerHTML = `<u>${inputEntity}</u> <b>would not be involved</b> in AP1 regarding the new statement.`
            results.appendChild(resultItem);
        }
    } else {
        console.log("Failed to acquire results.")
    }
}

handleParams()
