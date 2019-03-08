const token = require('./token.json');
const client = require('./credentials.json');
import {GoogleDriveApi, GoogleDriveFile, GoogleDriveFileList} from './DriveApi'


let access_token:string;
let API:GoogleDriveApi;

let path = ['root']
document.getElementById('initLogin').onclick = async () => {
	API = new GoogleDriveApi(client.client_id, client.client_secret, window);
	await API.getToken()//.catch(()=>{document.getElementsByTagName('body')[0].innerHTML = 'Couldn\'t login to Google Drive API. Please try again later by relaunching app.<br>App closing in 5 seconds'; setTimeout(()=>window.close(), 5000)});
	await listCurDir();
}
let files:GoogleDriveFile[];
const listCurDir = async () => {
	files = await API.getCurrentDirectory();
	const FileContainer = document.getElementById('files');
	FileContainer.innerHTML = '';

	for(let i = 0; i < files.length; i ++) {
		FileContainer.innerHTML += `<div><button onclick="${API.isFolder(files[i]) ? `changeDir('${files[i].id}', '${files[i].name}')">Open ${files[i].name}`: `downloadFile(${i})">Download ${files[i].name}`}</button></div>`
	}
	FileContainer.innerHTML += '<button onclick="back()">Go Back</button> <button onclick="API.reLogon()">Relogin</button>'
}

const downloadFile = (index:number) => {
	let file= files[index];
	API.downloadFile(file.id, file.name, file.mimeType);
}

const changeDir = (folderId:string) => {
	API.updateCurrentDirectory(folderId);
	path.push(folderId);
	listCurDir();
}

const back = () => {
	changeDir(path[path.length-2]);
	path.pop();
}