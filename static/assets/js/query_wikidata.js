const BASE_URL = "https://query.wikidata.org/sparql?query=";
const headers = {
    Accept: "application/sparql-results+json",
};

let buildQueryString = (queryEntity, queryString, replaceProperty) => {
    if (replaceProperty) {
        return queryString.replace(
            new RegExp(`Q${replaceProperty.slice(1)}`),
            queryEntity
        );
    } else {
        return queryString.replace(/Q\w+/gi, queryEntity);
    }
};

async function getRequestEndpoint(queryString) {
    try {
        let request = await fetch(BASE_URL + encodeURIComponent(queryString), {
            headers,
        });

        if (request) {
            let response = await request.json();
            return response;
        }
    } catch (error) {
        throw new Error(error.message);
    }
}

async function queryP279(subclass, superclass) {
    const P279_QUERY = `SELECT * WHERE { wd:${subclass} wdt:P279+ ${superclass} }`;

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P279_QUERY), {
            headers,
        });

        if (request) {
            let response = await request.json();
            return response;
        }
    } catch (error) {
        throw new Error(error.message);
    }
}

async function isSubclass(subclass, superclass) {
    const P279_QUERY = `SELECT * WHERE { BIND( EXISTS { wd:${subclass} wdt:P279+ ${superclass} } as ?isSubclass ) }`;

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P279_QUERY), {
            headers,
        });

        if (request) {
            let response = await request.json();
            return response["results"]["bindings"][0]["isSubclass"]["value"];
        }
    } catch (error) {
        throw new Error(error.message);
    }
}

async function areInstancesBulk(instance, entities) {
    let P31_QUERY = "SELECT * WHERE {\n";

    let nEntities = 0;
    for (let entity of entities) {
        P31_QUERY += `BIND( EXISTS { wd:${instance} wdt:P31 wd:${entity} } as ?isInstance${nEntities} ) .\n`;
        nEntities++;
    }
    P31_QUERY += "}";

    try {
        let request = await fetch(BASE_URL + encodeURIComponent(P31_QUERY), {
            headers,
        });

        if (request) {
            let response = await request.json();
            const results = Object.values(response["results"]["bindings"][0]);

            nEntities = 0;
            let areInstances = { true: [], false: [] };
            for (let result of results) {
                areInstances[result["value"]].push(entities[nEntities]);
                nEntities++;
            }

            return areInstances;
        }
    } catch (error) {
        throw new Error(error.message);
    }
}

function parseQueryResponseValue(result) {
    try {
        return result["subject"]["value"].match(/Q\w+/)[0];
    } catch {
        return result["object"]["value"].match(/Q\w+/)[0];
    }
}

function getPropertyLabel(property) {
    switch (property) {
        case "P31":
            return "instance of";
        case "P279":
            return "subclass of";
    }
}

async function checkForAntipatternUp(entity, statement) {
    const AP1_QUERY_TEMPLATE_UP = `SELECT * WHERE { wd:Q31 wdt:P31 ?object . wd:Q279 wdt:P279+ ?object . }`;

    let { newEntity, newProperty } = statement || { undefined };

    // Check for existing AP1
    const queryString = buildQueryString(entity, AP1_QUERY_TEMPLATE_UP);

    const response = await getRequestEndpoint(queryString);
    const results = response["results"]["bindings"] || [];

    let QIDsExistent = results.map(parseQueryResponseValue);

    // Check for AP1 with new statement
    let QIDsNew = [];
    if (newProperty == "P31") {
        // "entity is instance of newEntity" is true
        queryResult = await isSubclass(entity, "wd:" + newEntity);
        if (queryResult == "true") {
            // is "entity is subclass of newEntity" also true?
            QIDsNew = [newEntity]; // then it is a violation
        }
    } else if (newProperty == "P279") {
        // "entity P279 newEntity" is true
        const superclassesQuery = await queryP279(newEntity, "?object"); // get all newEntity's superclasses
        const superclasses = superclassesQuery["results"]["bindings"].map(
            parseQueryResponseValue
        );
        superclasses.push(newEntity);
        let areInstances = await areInstancesBulk(entity, superclasses); // is entity P31 newEntity or its superclasses also true?
        QIDsNew = areInstances["true"];
    }

    let antipatternsUp = {
        existent: QIDsExistent,
        new: QIDsNew,
    };

    return antipatternsUp;
}

function checkListOverlap(list1, list2) {
    for (let element of list1) {
        if (list2.includes(element)) {
            return true;
        }
    }

    return false;
}

async function findNewAP1Down(entity, newEntity) {
    const AP1_QUERY_DOWN_NEW_P279 = `SELECT ?subject WHERE { ?subject wdt:P279+ wd:${entity} . ?subject wdt:P31 wd:${newEntity} . }`;

    const response = await getRequestEndpoint(AP1_QUERY_DOWN_NEW_P279);
    const results = response["results"]["bindings"];

    return results;
}

async function checkForAntipatternDown(entity, statement) {
    const AP1_QUERY_TEMPLATE_DOWN = `SELECT * WHERE { ?subject wdt:P31 wd:Q31 . ?subject wdt:P279+ wd:Q279  . }`;

    let { newEntity, newProperty } = statement || { undefined };

    // Query for entities that are both instance of "entity" and subclass of "entity"
    const queryString = buildQueryString(entity, AP1_QUERY_TEMPLATE_DOWN);
    const response = await getRequestEndpoint(queryString);
    const results = response["results"]["bindings"];
    let QIDsInstancesAndSubclasses = results.map(parseQueryResponseValue);

    // Check for AP1 with new statement
    // New statements with 'P31' property won't generate new violations below entity, so we don't need to check for it
    let QIDsNew = [];
    if (newProperty == "P279") {
        // "entity P279 newEntity" would be true
        // Query for subclasses of "entity" are instances of "newEntity"
        let resultsAP1Down = await findNewAP1Down(entity, newEntity);
        QIDsNew = resultsAP1Down.map(parseQueryResponseValue);
    }

    let antipatternsDown = {
        existent: QIDsInstancesAndSubclasses,
        new: QIDsNew,
    };

    return antipatternsDown;
}

function getUrlVars() {
    // Parse query params vars
    var vars = {};
    var parts = window.location.href.replace(
        /[?&]+([^=&]+)=([^&]*)/gi,
        function (m, key, value) {
            vars[key] = value;
        }
    );
    return vars;
}

async function getLabelsBulk(entities) {
    let QUERY_LABEL_STRING =
        "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT * WHERE { ";
    let nEntities = 0;

    for (let entity of entities) {
        if (entity) {
            QUERY_LABEL_STRING += `wd:${entity} rdfs:label ?subjectLabel${nEntities} .\n FILTER (lang(?subjectLabel${nEntities}) = "" || lang(?subjectLabel${nEntities}) = "en") .\n`;
            nEntities++;
        }
    }
    QUERY_LABEL_STRING += "}";

    const response = await getRequestEndpoint(QUERY_LABEL_STRING);

    nEntities = 0;
    const labelsDict = {};

    const results = response["results"]["bindings"][0];

    let objEntries = Object.entries(results);
    objEntries = objEntries.sort(function (first, second) {
        return first[0].localeCompare(second[0], undefined, { numeric: true });
    });

    for (let [entry, value] of objEntries) {
        labelsDict[entities[nEntities]] = value["value"];
        nEntities++;
    }

    return labelsDict;
}

function createMultipleEntitiesLabelsString(entities, labels) {
    let nEntities = 1;
    let entitiesString = "";

    for (entity of entities) {
        entitiesString += `${labels[entity]} (<a href="https://wikidata.org/wiki/${entity}"><u>${entity}</u></a>)`;

        if (nEntities != entities.length) {
            entitiesString += ", ";
        }
        nEntities++;
    }

    return entitiesString;
}

async function handleParams() {
    const MAX_ITEMS = 3; // Limit number of entities to be shown

    params = getUrlVars();
    let antipatternsUp, antipatternsDown;

    const inputEntity = params["inputEntity"].toUpperCase();
    const inputNewProperty = params["inputNewProperty"].toUpperCase();
    const inputNewEntity = params["inputNewEntity"].toUpperCase();

    // Show "Loading..." on page while results aren't ready
    const prompt = document.querySelector("#prompt h2");
    let promptTitle = document.createElement("h2");
    promptTitle.innerHTML = "Loading...";
    prompt.appendChild(promptTitle);

    switch (params["analysis-option"]) {
        case "existent":
            // Check only for existing anti-patterns
            antipatternsUp = await checkForAntipatternUp(inputEntity);
            antipatternsDown = await checkForAntipatternDown(inputEntity);
            break;
        case "new":
            // Check also for hypothetical anti-patterns
            const statement = {
                newEntity: inputNewEntity,
                newProperty: inputNewProperty,
            };
            antipatternsUp = await checkForAntipatternUp(
                inputEntity,
                statement
            );
            antipatternsDown = await checkForAntipatternDown(
                inputEntity,
                statement
            );

            // Display hypothetical statement on page if it exists
            const comment = document.querySelector("#comment");

            let commentTitle = document.createElement("p");
            commentTitle.innerHTML = "New statement:";

            let newStatementQuery = document.createElement("code");
            newStatementQuery.innerHTML = `<a href=https://www.wikidata.org/wiki/${inputEntity}><i>wd:${inputEntity}</a> <a href=https://www.wikidata.org/wiki/Property:${inputNewProperty}>wdt:${inputNewProperty}</a> <a href=https://www.wikidata.org/wiki/${inputNewEntity}>wd:${inputNewEntity}</i></a>`;

            comment.appendChild(commentTitle);
            comment.appendChild(newStatementQuery);
            break;
        default:
            console.log("Unrecognized option.");
    }

    // Save quantity of entities
    antipatternsUpExistentQuantity = antipatternsUp["existent"].length;
    antipatternsDownExistentQuantity = antipatternsDown["existent"].length;
    antipatternsUpNewQuantity = antipatternsUp["new"].length;
    antipatternsDownNewQuantity = antipatternsDown["new"].length;

    // Limit lists of entities to MAX_ITEMS
    antipatternsUp["existent"].splice(MAX_ITEMS);
    antipatternsDown["existent"].splice(MAX_ITEMS);
    antipatternsUp["new"].splice(MAX_ITEMS);
    antipatternsDown["new"].splice(MAX_ITEMS);

    // Create list with all remaining entities then get labels for all of them
    const allEntities = [
        ...antipatternsUp["existent"],
        ...antipatternsUp["new"],
        ...antipatternsDown["existent"],
        ...antipatternsDown["new"],
        inputEntity,
        inputNewEntity,
    ];

    allLabels = await getLabelsBulk(allEntities);

    prompt.removeChild(promptTitle);

    if (antipatternsUp) {
        const resultsUp = document.querySelector("#results-up");

        if (antipatternsUp["existent"].length > 0) {
            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "failure");

            const existentMultipleStringUp = createMultipleEntitiesLabelsString(
                antipatternsUp["existent"],
                allLabels
            );
            resultItem.innerHTML = `Currently, ${allLabels[inputEntity]} (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) <b>is</b>, simultaneously, instance and subclass of `;
            resultItem.innerHTML += existentMultipleStringUp;

            if (antipatternsUpNewQuantity > MAX_ITEMS) {
                resultItem.innerHTML += `, [...] (${antipatternsUpExistentQuantity} entities)`;
            }
            resultItem.innerHTML += ".";

            resultsUp.appendChild(resultItem);
        } else {
            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "success");
            resultItem.innerHTML = `Currently, ${allLabels[inputEntity]} (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) <b>is not</b>, simultaneously, instance and subclass of another entity.`;

            resultsUp.appendChild(resultItem);
        }

        if (antipatternsUp["new"].length > 0) {
            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "failure");

            const newMultipleStringUp = createMultipleEntitiesLabelsString(
                antipatternsUp["new"],
                allLabels
            );
            resultItem.innerHTML = `If ${
                allLabels[inputEntity]
            } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) were ${getPropertyLabel(
                inputNewProperty
            )} ${
                allLabels[inputNewEntity]
            } (<a href="https://wikidata.org/wiki/${inputNewEntity}"><u>${inputNewEntity}</u></a>), then ${
                allLabels[inputEntity]
            } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) <b>would be</b>, simultaneously, instance and subclass of ${newMultipleStringUp}`;
            if (
                checkListOverlap(
                    antipatternsUp["existent"],
                    antipatternsUp["new"]
                )
            ) {
                resultItem.innerHTML += " through <i>new</i> transitive paths";
            }
            resultItem.innerHTML += ".";

            resultsUp.appendChild(resultItem);
        } else if (params["analysis-option"] == "new") {
            const resultsUp = document.querySelector("#results-up");

            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "success");

            if (antipatternsUp["existent"].length == 0) {
                resultItem.innerHTML = `Even if ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) were ${getPropertyLabel(
                    inputNewProperty
                )} ${
                    allLabels[inputNewEntity]
                } (<a href="https://wikidata.org/wiki/${inputNewEntity}"><u>${inputNewEntity}</u></a>), then ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) <b>would still not be</b>, simultaneously, instance and subclass of another entity.`;
            } else {
                resultItem.innerHTML = `If ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) were ${getPropertyLabel(
                    inputNewProperty
                )} ${
                    allLabels[inputNewEntity]
                } (<a href="https://wikidata.org/wiki/${inputNewEntity}"><u>${inputNewEntity}</u></a>), then ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) <b>would not be</b>, simultaneously, instance and subclass of another entity in a new way.`;
            }

            resultsUp.appendChild(resultItem);
        }
    } else {
        console.log(
            `Failed to acquire results for anti-patterns above ${inputEntity}.`
        );
    }

    if (antipatternsDown) {
        const resultsDown = document.querySelector("#results-down");
        if (antipatternsDown["existent"].length > 0) {
            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "failure");

            const existentMultipleStringDown =
                createMultipleEntitiesLabelsString(
                    antipatternsDown["existent"],
                    allLabels
                );
            resultItem.innerHTML += "Currently, ";
            resultItem.innerHTML += existentMultipleStringDown;

            if (antipatternsDown["existent"].length > 1) {
                resultItem.innerHTML += `, [...] (${antipatternsDownExistentQuantity} entities) <b>are</b>, simultaneously, instances and subclasses of ${allLabels[inputEntity]} (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>).`;
            } else {
                resultItem.innerHTML += ` <b>is</b>, simultaneously, instance and subclass of ${allLabels[inputEntity]} (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>).`;
            }
            resultsDown.appendChild(resultItem);
        } else {
            const resultsUp = document.querySelector("#results-down");

            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "success");
            resultItem.innerHTML = `Currently, <b>there are no entities</b> that are, simultaneously, instances and subclasses of ${allLabels[inputEntity]} (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>).`;

            resultsUp.appendChild(resultItem);
        }

        if (antipatternsDown["new"].length > 0) {
            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "failure");

            const newMultipleStringDown =
                await createMultipleEntitiesLabelsString(
                    antipatternsDown["new"],
                    allLabels
                );

            if (antipatternsDownNewQuantity > MAX_ITEMS) {
                resultItem.innerHTML = `If ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) were ${getPropertyLabel(
                    inputNewProperty
                )} ${
                    allLabels[inputNewEntity]
                } (<a href="https://wikidata.org/wiki/${inputNewEntity}"><u>${inputNewEntity}</u></a>), then ${newMultipleStringDown}, [...] (${antipatternsDownNewQuantity} entities) <b>would be</b>, simultaneously, instances and subclasses of ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</a></u>) through <i>new</i> transitive paths.`;
            } else {
                resultItem.innerHTML = `If ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) were ${getPropertyLabel(
                    inputNewProperty
                )} ${
                    allLabels[inputNewEntity]
                } (<a href="https://wikidata.org/wiki/${inputNewEntity}"><u>${inputNewEntity}</u></a>), then ${newMultipleStringDown} <b>would be</b>, simultaneously, instance and subclass of ${
                    allLabels[inputEntity]
                } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</a></u>) through <i>new</i> transitive paths.`;
            }
            resultsDown.appendChild(resultItem);
        } else if (params["analysis-option"] == "new") {
            let resultItem = document.createElement("p");
            resultItem.setAttribute("class", "success");
            resultItem.innerHTML = `If ${
                allLabels[inputEntity]
            } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>) were ${getPropertyLabel(
                inputNewProperty
            )} ${
                allLabels[inputNewEntity]
            } (<a href="https://wikidata.org/wiki/${inputNewEntity}"><u>${inputNewEntity}</u></a>), then <b>there would still be no new entities</b> that are, simultaneously, instances and subclasses of ${
                allLabels[inputEntity]
            } (<a href="https://wikidata.org/wiki/${inputEntity}"><u>${inputEntity}</u></a>).`;

            resultsDown.appendChild(resultItem);
        }
    } else {
        console.log(
            `Failed to acquire results for anti-patterns below ${inputEntity}.`
        );
    }
}

handleParams();
