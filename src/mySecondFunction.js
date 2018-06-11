'use strict';

exports.handler = async (event, context) => {
	console.log("Function loaded! " + context.functionName  +  ":"  +  context.functionVersion);
	let responseBody = {
		message: "Hello from " + context.functionName  +  " version "  +  context.functionVersion + " !"
	};
	let response = {
		statusCode: 200,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(responseBody)
	};
	return response;
};