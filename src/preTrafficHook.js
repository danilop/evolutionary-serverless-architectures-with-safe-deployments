'use strict';

const AWS = require('aws-sdk');
const CodeDeploy = new AWS.CodeDeploy();
const Lambda = new AWS.Lambda();
const CloudWatch = new AWS.CloudWatch();
const CloudFormation = new AWS.CloudFormation();
const DynamoDB = new AWS.DynamoDB();
const S3 = new AWS.S3();
const ConfigService = new AWS.ConfigService();

const stackId = process.env.StackId;
const functionName = process.env.CurrentVersion;
const namespace = process.env.Namespace;
const metricName = process.env.MetricName;

let currentFunctionName; // To be read from the context

let deploymentStatus;


async function manageApiPagination(objectToCall, methodToCall, params, keyToReturn) {
	let list = [];
	do {
		let data = await objectToCall[methodToCall](params).promise();
		console.log(data);
		for (let item of data[keyToReturn]) {
			list.push(item);
		}
		params.NextToken = data.NextToken;
	} while (params.NextToken != null);
	console.log(list);
	return list;
}


// Return the list of resources in a CloudFormation Stack
async function listStackResources(stackName) {
	console.log("Calling AWS CloudFormation to list Resources for Stack " + stackName);
	return await manageApiPagination(CloudFormation, 'listStackResources', {
		StackName: stackName
	}, 'StackResourceSummaries');
}


// Run a basic check on a Lambda Function
async function testFunction(functionName) {
	let localFitness = 0;
	console.log("Calling AWS Lambda to test Function " + functionName);
	let data = await Lambda.invoke({
		FunctionName: functionName,
		Payload: '"test"' // Default test input value
	}).promise();
	console.log(data); // successful response
	if (data.StatusCode >= 200 && data.StatusCode < 300) {
		localFitness++;
		let body = JSON.parse(data.Payload).body;
		// More specific tests can be implemented per function
		if (body !== undefined) {
			let jsonBody = JSON.parse(body);
			let message = jsonBody.message;
		 	if (message != undefined && message.startsWith('Hello')) {
				// Incrementing fitness for each "passed" unit test
				localFitness++;
			 }
		}
	} else {
		deploymentStatus = 'Fail'; // Function invocation failed 
	}
	return localFitness;
}


// Check that a DynamoDB Table has encryption at rest enabled
async function testDynamoDBEncryption(table) {
	let localFitness = 0;
	console.log("Calling Amazon DynamoDB to check encryption for Table " + table);
	let data = await DynamoDB.describeTable({
		TableName: table
	}).promise();
	console.log(data);
	if ('SSEDescription' in data.Table) {
		let status = data.Table.SSEDescription.Status;
		if (status == 'ENABLED' || status == 'ENABLING') {
			localFitness =+ 5;
		}
	}
	return localFitness;
}


// Check that a DynamoDB Table has Continuous Backup enabled
// Can be implemented using the DynamoDB DescribeContinuousBackups API
async function testDynamoDBBackup(table) { return 0 } // TODO


// Check that an S3 Bucket has encryption at rest enabled
async function testS3EncryptionAtRest(bucket) {
	let localFitness = 0;
	console.log("Calling Amazon S3 to check encryption at rest for Bucket " + bucket);
	let data;
	try {
		data = await S3.getBucketEncryption({
			Bucket: bucket
		}).promise();
	} catch(err) {
		if (err.code == 'ServerSideEncryptionConfigurationNotFoundError') {
			return localFitness; // No SSE configured
		} else {
			throw err;
		}
	}
	console.log(data);
	let rules = data.ServerSideEncryptionConfiguration.Rules;
	for (let r of rules) {
		let status = r.ApplyServerSideEncryptionByDefault.SSEAlgorithm;
		if (status == 'AES256') {
			localFitness += 3; // Base score
		}
		if (status == 'aws:kms') {
			localFitness += 6; // Premium score for using AWS KMS
		}
	}
	return localFitness;
}


// Check that all S3 Buckets have HTTPS-only access (SecureTransport)
// Can be implemented checking the Condition of the Bucket Policy
async function testS3EncryptionInTransit(bucket) { return 0 } // TODO


// Check compliance to AWS Config Rules
async function checkCompliance(resourceType, resourceId) {
	let localFitness = 0;
	console.log("Calling AWS Config to check compliance to all Rules for Resource " + resourceType + " " + resourceId);
	let compliantResults = await manageApiPagination(ConfigService, 'getComplianceDetailsByResource', {
		ComplianceTypes: [
		  'COMPLIANT' 
		],
		ResourceType: resourceType,
		ResourceId: resourceId
	  }, 'EvaluationResults');
	localFitness += 10 * compliantResults.length;
	console.log("Resource " + resourceType + " " + resourceId +
		" is compliant to " + compliantResults.length + " rules");
	return localFitness;
}

async function runTests() {

	let tests = [];

	// Unit tests
	tests.push(testFunction(functionName)); // With version

	// Check all resources in the stack
	let resources = await listStackResources(stackId);

	for (let r of resources) {
		switch(r.ResourceType) {
			case 'AWS::S3::Bucket':
				tests.push(testS3EncryptionAtRest(r.PhysicalResourceId));
				tests.push(testS3EncryptionInTransit(r.PhysicalResourceId));
				/* Using AWS Config Rules, for example:
					s3-bucket-logging-enabled
					s3-bucket-replication-enabled
					s3-bucket-versioning-enabled
					s3-bucket-public-write-prohibited
					s3-bucket-public-read-prohibited
					s3-bucket-ssl-requests-only
					s3-bucket-server-side-encryption-enabled
				*/
				tests.push(checkCompliance(r.ResourceType, r.PhysicalResourceId));
				break;
			case 'AWS::DynamoDB::Table':
				tests.push(testDynamoDBEncryption(r.PhysicalResourceId));
				tests.push(testDynamoDBBackup(r.PhysicalResourceId));
				/* Using AWS Config Rules, for example:
					dynamodb-autoscaling-enabled
					dynamodb-throughput-limit-check
				*/
				tests.push(checkCompliance(r.ResourceType, r.PhysicalResourceId));
				break;
			case 'AWS::Lambda::Function':
				if (r.PhysicalResourceId != currentFunctionName) {
					tests.push(testFunction(r.PhysicalResourceId)); // No version
				} else {
					console.log("Skipping self invocation.");
				}
				/* Using AWS Config Rules, for example:
					lambda-function-public-access-prohibited
					lambda-function-settings-check
				*/
				tests.push(checkCompliance(r.ResourceType, r.PhysicalResourceId));
				break;
			default:
		}
	}

	return Promise.all(tests);
}


async function reportExecutionStatus(deploymentId, lifecycleEventHookExecutionId, status) {
	if (deploymentId == null) {
		console.log("No deployment requested.");
		return;
	}
	console.log("Calling CodeDeploy with Status " + status);
	let data = await CodeDeploy.putLifecycleEventHookExecutionStatus({
		deploymentId: deploymentId,
		lifecycleEventHookExecutionId: lifecycleEventHookExecutionId,
		status: status // status can be 'Succeeded' or 'Failed'
	}).promise();
	console.log(data);
}


async function putMetric(value) {
	console.log("Posting metric data to CloudWatch " + namespace + " " + metricName + " = " + value);
	var data = await CloudWatch.putMetricData({
		MetricData: [
			{
			MetricName: metricName,
			Timestamp: new Date,
			// Unit: "None",
			Value: value
			}
		],
		Namespace: namespace
	}).promise();
	console.log(data);
}


exports.handler = async (event, context) => {

	console.log("Entering PreTraffic Hook!");
	console.log(JSON.stringify(event));

	if (event == "test") {
		return "ok";
	}

	currentFunctionName = context.functionName;
	
	//Read the DeploymentId from the event payload.
	let deploymentId = event.DeploymentId;
	console.log("DeploymentId: " + deploymentId);

	//Read the LifecycleEventHookExecutionId from the event payload
	let lifecycleEventHookExecutionId = event.LifecycleEventHookExecutionId;
	console.log("LifecycleEventHookExecutionId: " + lifecycleEventHookExecutionId);

	/*
		[Perform validation or prewarming steps here]
	*/

	deploymentStatus = 'Succeeded'; // Starting value

	try {
		let testResults = await runTests();
		let fitness = testResults.reduce((a, b) => a + b, 0); // Sum all results
		console.log("fitness = " + fitness);
		console.log("deploymentStatus = " + deploymentStatus);
		await reportExecutionStatus(deploymentId, lifecycleEventHookExecutionId, deploymentStatus);
		await putMetric(fitness);
	}
	catch (err) {
		console.log(err, err.stack); // an error occurred
		throw err;
	}

};