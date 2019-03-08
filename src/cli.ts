import * as snek from 'snekfetch';
import * as fs from 'fs';
import * as readline from 'readline'


type GoogleDriveFile = {
    name:string,
    id:string,
    mimeType:string
}

type GoogleDriveFileList = {
    files:GoogleDriveFile[]
} 

type TokenResponce = {
	expires_in:number,
	access_token:string,
	expirery:undefined|number
}


let curdir = '';

const args = process.argv.slice(2);
let {
	access_token,
	expirery
} = JSON.parse(fs.readFileSync('./token.json').toString());

const _GETFiles = (endpoint:string, params:string = ''):Promise<GoogleDriveFileList|GoogleDriveFile> => new Promise((resolve, reject) => {
	const data = snek.get('https://www.googleapis.com/drive/v3/files' + endpoint + '?' + params, {
		'headers': {
			'Authorization': `Bearer ${access_token}`
		}
	}).then((data) => resolve(<GoogleDriveFile|GoogleDriveFileList>data.body)).catch((err) => {
		reject(err);
	});
});


const isFileList = (arg:GoogleDriveFile|GoogleDriveFileList):arg is GoogleDriveFileList => {
	return (<GoogleDriveFileList>arg).files !== undefined;
}



/**
 * 
 * @param {string} question 
 * @returns {Promise<string>}
 */
const question = (question:string):Promise<string> => {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise((resolve, reject) => {
		try {
			rl.question(question, (answer) => {
				rl.close();
				resolve(answer);
			})
		} catch (e) {
			reject(e);
		}
	})
}


const getToken = async () => {
	const scope = 'https://www.googleapis.com/auth/drive.readonly'
	const client = require('./credentials.json');
	const url = `https://accounts.google.com/o/oauth2/v2/auth?${`client_id=${client.client_id}&redirect_uri=${encodeURIComponent('urn:ietf:wg:oauth:2.0:oob')}&scope=${scope}&response_type=code`}`;
	console.log(`Get api token here: ${url}`)
	let token = await question('Enter the api token here:');
	const uro = encodeURIComponent(`code=${token}&client_id=${client.client_id}&client_secret=${client.client_secret}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&grant_type=authorization_code`).replace(/%26/g, '&').replace(/%3D/g, '=');
	let data = await snek.post(`https://www.googleapis.com/oauth2/v4/token?${uro}`)
	let tokenRes = <TokenResponce>data.body;
	tokenRes.expirery = (tokenRes.expires_in * 1000) + new Date().getTime();
	access_token = tokenRes.access_token;
	fs.writeFileSync('./token.json', JSON.stringify(tokenRes));
}

const searchFolder = async (fileName, folderID = undefined) => {
	if (curdir != '' && !folderID) folderID = curdir;
	let list = !folderID ? await _GETFiles('', `q=name%20contains%20'${fileName}'`) : await _GETFiles('', `q=name%20contains%20'${fileName}'%20and%20'${folderID}'%20in%20parents`);
	if(!isFileList(list)) return [list];
	return list.files;
}

const getAllInFolder = async (folderId, pageToken = null) => {
	let list
	if (!folderId) list = pageToken != null ? await _GETFiles('', `pageToken=${pageToken}`) : await _GETFiles('', '')
	else list = pageToken != null ? await _GETFiles('', `q='${folderId}'%20in%20parents&pageToken=${pageToken}`) : await _GETFiles('', `q='${folderId}'%20in%20parents`);
	if (list.nextPageToken) list.files = list.files.concat(await getAllInFolder(folderId, list.nextPageToken));
	return list.files;
}

const testFolder = async (folderId) => {
	try {
		const list = await _GETFiles('', `q=\'${folderId}\'%20in%20parents`);
		if ((<GoogleDriveFileList>list).files) return true;
		return false;
	} catch (e) {
		console.error(e);
		return false;
	}
}

const downloadArray = async (fileArray) => {
	let i = 0;
	console.log(`Downloading ${fileArray.length} files, this might take a while.`);
	const downloads = fs.readdirSync('./downloads');
	fileArray.forEach(async file => {
				if (file.name == '_DS_Store') return;
		if (args.indexOf('-r') != -1 && downloads.indexOf(file.name) != -1) return console.log(`${file.name} has already been downloaded, not overwriting`);
		setTimeout(async () => {
			await downloadFile(file.id, file.name);
		}, 150 * i);
		i++;
	});
}

const downloadFile = async (fileId, fileName) => {
	try {
		console.log(`Downloading ${fileName} (${fileId})`);
		_GETFiles('/'+fileId, 'alt=media').then((data) => fs.writeFileSync(`./downloads/${fileName}`, data)).catch((err) => {throw err});
	} catch (e) {
		console.error(e);
		process.exit();
	}
}

const help = () => {
	console.log(`node ${__filename} [options]`);
	console.log('	--getFolder or -f [folder id]	Downloads the contents of [folder id]');
	console.log('	--seach or -s [search term] [folder]')
}

const main = async () => {
	if (args.length == 0 || args.indexOf('--help') != -1) return help();
	for (var i = 0; i < args.length; i++) {
		let arg = args[i];
		console.log(arg);

		if (arg == '--getFolder' || arg == '-f') {
			let folder = args[i + 1]
			i++;
			let valid = await testFolder(folder)
			if (!valid) break;
			let files = await getAllInFolder(folder);
			console.log(files);
			downloadArray(files);
		}
		if (arg == '--getFile') {
			let f = args[i + 1];
			i++;
			let fil = await _GETFiles('/' + f)
			if(isFileList(fil)) break;
			downloadFile(fil.id, fil.name)
		}
		if (arg == '--search' || arg == '-s') {
			console.log('searching...')
			let name = args[i + 1];
			let folde = args[i + 2];
			if (folde == undefined || folde.startsWith('-')) {
				folde = null;
				i++;
			} else {
				i += 2;
			}
			let file = await searchFolder(name, folde);
			console.log(file);
			if (file.length == 1 && file[0].mimeType == 'application/vnd.google-apps.folder') curdir = file[0].id
			else {
				let options = file //.filter(f => f.mimeType=='application/vnd.google-apps.folder');
				if (!(args.indexOf('--autopick') != -1) && file.length > 1) {
					for (var e = 0; e < options.length; e++) {
						console.log(`Option ${e}: ${options[e].name}`);
					}
					let answer = await question('What file would you like to dowload, or open.\n');
					if (!parseInt(answer) && answer != 'all') console.error('Answer isn\'t a number'); 
					if(answer != 'all' && file[answer].mimeType != 'application/vnd.google-apps.folder')await downloadFile(options[answer].id, options[answer].name);
					else if(answer != 'all' && file[answer].mimeType == 'application/vnd.google-apps.folder')curdir = file[answer].id;
					else await downloadArray(options);
				} else {
					for (let e = 0; e < options.length; e++) {
						if (options[e].mimeType != 'application/vnd.google-apps.folder') {
							await downloadFile(options[e].id, options[e].name);
							break;
						}
					}
				}
			}
		}
		if (arg == '--listdir' || arg == '-ls') {
			let stuffs = await getAllInFolder(curdir);
			stuffs.forEach((f) => console.log(`${f.name}: ${f.id}`))
		}
	}
}
if (!access_token || new Date().getTime() > expirery || args.indexOf('--getToken') != -1) {
	getToken().then(() => main())
} else main().catch((err) => console.error(err))