/**
 * Created by wangh09 on 2017/12/13.
 */
let grpc = require('grpc');
let _ccProto = grpc.load('inkchain-client/lib/protos/peer/chaincode.proto').protos;
let ethUtils = require('ethereumjs-util');
const Long = require('long');
let invokeHandler = require('./invoke-transaction');
let queryHandler = require('./query');
function signTX(ccId, fcn, arg, msg, counter, inkLimit, priKey) {
    let args = [];
    let senderAddress = ethUtils.privateToAddress(new Buffer(priKey, "hex"));
    let senderSpec = {
        sender: Buffer.from(senderAddress.toString("hex")),
        counter: Long.fromString(counter.toString()),
        ink_limit: Buffer.from(inkLimit),
        msg: Buffer.from(msg)
    };
    args.push(Buffer.from(fcn ? fcn : 'invoke', 'utf8'));
    for (let i=0; i<arg.length; i++) {
        args.push(Buffer.from(arg[i], 'utf8'));
    }
    let invokeSpec = {
        type: _ccProto.ChaincodeSpec.Type.GOLANG,
        chaincode_id: {
            name: ccId
        },
        input: {
            args: args
        }
    };
    let cciSpec = new _ccProto.ChaincodeInvocationSpec();
    let signContent = new _ccProto.SignContent();
    signContent.setChaincodeSpec(invokeSpec);
    signContent.setSenderSpec(senderSpec);
    signContent.id_generation_alg = cciSpec.id_generation_alg;
    let signHash = ethUtils.sha256(signContent.toBuffer());
    let sigrsv = ethUtils.ecsign(signHash, new Buffer(priKey, "hex"));

    return Buffer.concat([
        ethUtils.setLengthLeft(sigrsv.r, 32),
        ethUtils.setLengthLeft(sigrsv.s, 32),
        ethUtils.toBuffer(sigrsv.v - 27)
    ]);
}

function invoke(peerNames, channelName, chaincodeName, fcn, args, username, org, senderAddress, msg, inkLimit, counter, sig) {
    let senderSpec = {
        sender: Buffer.from(senderAddress),
        counter: Long.fromString(counter.toString()),
        ink_limit: Buffer.from(inkLimit),
        msg: Buffer.from(msg)
    };
    return invokeHandler.invokeChaincode(peerNames, channelName, chaincodeName, fcn, args, username, org, senderSpec, sig);
}
function queryCounter(peer, channelName, CC_ID, fcn, args, username, org) {
    return queryHandler.queryChaincode(peer,channelName,CC_ID,args, fcn, username, org);
}
let sdk_counter = 0;
let queue_length = 0;
let max_queue_length = 10;
let mutex_counter = false;
let clean_counter = false;
let sender_address = "";
function invokeChaincodeSigned(peerNames, channelName, ccId, fcn, args, username, org, inkLimit, msg, priKey) {
    let senderAddress = ethUtils.privateToAddress(new Buffer(priKey,"hex")).toString('hex');
    return queryCounter(peerNames[0], channelName, ccId, 'counter',[senderAddress],username,org).then((counter) => {
        let sig = signTX(ccId, fcn, args, msg, counter[0].toString(), inkLimit, priKey);
        return invoke(peerNames, channelName, ccId, fcn, args, username, org, senderAddress, msg, inkLimit, counter[0].toString(), sig);
    });
}
/*
async function invokeChaincodeSigned(peerNames, channelName, ccId, fcn, args, username, org, inkLimit, msg, priKey) {
    if (mutex_counter || queue_length >= max_queue_length) {
        await sleep(300);
        return invokeChaincodeSigned(peerNames, channelName, ccId, fcn, args, username, org, inkLimit, msg, priKey);
    } else {
        mutex_counter = true;
        let senderAddress = ethUtils.privateToAddress(new Buffer(priKey,"hex")).toString('hex');
        if(senderAddress != sender_address) {
            sdk_counter = 0;
            sender_address = senderAddress;
        }
        if(sdk_counter == null || sdk_counter == 0) {
            // query counter & send transaction
            let promise = Promise.resolve();
            return promise.then(() => {
                return queryCounter(peerNames[0], channelName, ccId, 'counter',[senderAddress],username,org).then((counter) => {
                    sdk_counter = parseInt(counter[0]) + 1;
                    let sig = signTX(ccId, fcn, args, msg, counter[0].toString(), inkLimit, priKey);

                    queue_length ++;
                    mutex_counter = false;
                    return invoke(peerNames, channelName, ccId, fcn, args, username, org, senderAddress, msg, inkLimit, counter[0].toString(), sig);
                });
            }).catch((err) => {
                if(mutex_counter)
                    clean_counter = true;
                else
                    sdk_counter = 0;
                queue_length--;
                return invokeChaincodeSigned(peerNames, channelName, ccId, fcn, args, username, org, inkLimit, msg, priKey);
            }).then((result) => {
                queue_length--;
                return result;
            });
        } else {
            // counter++ & send transaction
            if(clean_counter) {
                clean_counter = false;
                sdk_counter = 0;
                mutex_counter = false;
                return invokeChaincodeSigned(peerNames, channelName, ccId, fcn, args, username, org, inkLimit, msg, priKey);
            } else {
                let counter_now = sdk_counter;
                sdk_counter ++;
                queue_length ++;
                mutex_counter = false;
                let sig = signTX(ccId, fcn, args, msg, counter_now, inkLimit, priKey);
                return invoke(peerNames, channelName, ccId, fcn, args, username, org, senderAddress, msg, inkLimit, counter_now, sig).then((result)=>{
                    queue_length--;
                    return result;
                }).catch((err)=>{
                    if(mutex_counter) {
                        clean_counter = true;
                    } else {
                        sdk_counter = 0;
                    }
                    queue_length--;
                    return invokeChaincodeSigned(peerNames, channelName, ccId, fcn, args, username, org, inkLimit, msg, priKey);
                });

            }
        }
    }
}
*/
module.exports.invokeChaincodeSigned = invokeChaincodeSigned;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}