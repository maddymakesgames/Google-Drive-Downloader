
import * as snek from 'snekfetch';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import {ipcRenderer} from 'electron';

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
    expirery:undefined|number;
    refresh_token:string;
}

type ClientInfo = {
    client_id:string,
    client_secret:string
}



class GoogleDriveApi {
	constructor(client_id:string, client_secret:string, window:Window) {
        this.client = (<ClientInfo>{client_id:client_id, client_secret:client_secret});
        this.window = window;
    }
    private client:ClientInfo;
    private token:string;
    private curdir:string = 'root';
    private refresh_token:string;
    private window:Window

    getToken = async () => {
        const scope = 'https://www.googleapis.com/auth/drive.readonly'
        
        const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.client.client_id}&redirect_uri=${encodeURIComponent('http://localhost:8000')}&scope=${scope}&response_type=code`;
        
        
        ipcRenderer.send('login', url);
        let tken;
        try {
            tken = await this.waitForToken();
        }
        catch(e) {
            throw e;
        }
    
        console.log(tken);
    
        const uro = encodeURIComponent(`code=${tken}&client_id=${this.client.client_id}&client_secret=${this.client.client_secret}&redirect_uri=http://localhost:8000&grant_type=authorization_code`).replace(/%26/g, '&').replace(/%3D/g, '=');
        console.log(uro);
        
        let data = await snek.post(`https://www.googleapis.com/oauth2/v4/token?${uro}`)
        let tokenRes = (<TokenResponce>data.body);
        tokenRes.expirery = (tokenRes.expires_in * 1000) + new Date().getTime();
        this.token = tokenRes.access_token;
        this.refresh_token = tokenRes.refresh_token;
        setTimeout(this.refreshToken, tokenRes.expires_in*1000);
    }

	private _GETFiles = (endpoint:string, params:string = ''):Promise<GoogleDriveFileList|GoogleDriveFile> => new Promise((resolve, reject) => {
		const data = snek.get('https://www.googleapis.com/drive/v3/files' + endpoint + '?' + params, {
			'headers': {
				'Authorization': `Bearer ${this.token}`
			}
		}).then((data) => resolve(<GoogleDriveFile|GoogleDriveFileList>data.body)).catch((err) => {
			reject(err);
		});
	});
    
    private _GETFilesStream = (endpoint:string, params:string = '', writeStream:fs.WriteStream):void => {
        // const data = snek.get('https://www.googleapis.com/drive/v3/files' + endpoint + '?' + params, {
		// 	'headers': {
		// 		'Authorization': `Bearer ${this.token}`
		// 	}})
        https.get('https://www.googleapis.com/drive/v3/files' +endpoint + '?' + params,{headers:{'Authorization':`Bearer ${this.token}`}},(res) => {
            res.on('data', (chunk) => {
                writeStream.write(chunk);
            });
            res.on('end', () => {
                writeStream.end()
                new this.window.Notification(`${(<string>writeStream.path).split('/')[(<string>writeStream.path).split('/').length-1]} has finished downloading.`);
            })
            res.on('error', () => {
                writeStream.end();
                console.error(`Error Getting ${endpoint}`);
                fs.unlinkSync(writeStream.path);
            })
        })
    }

	
	isFileList = (arg:GoogleDriveFile|GoogleDriveFileList):arg is GoogleDriveFileList => {
		return (<GoogleDriveFileList>arg).files !== undefined;
	}
	
	searchFolder = async (fileName:string, folderID:string = undefined):Promise<GoogleDriveFile[]> => {
		if (this.curdir != '' && !folderID) folderID = this.curdir;
		let list = !folderID ? await this._GETFiles('', `q=name%20contains%20'${fileName}'`) : await this._GETFiles('', `q=name%20contains%20'${fileName}'%20and%20'${folderID}'%20in%20parents`);
		if(!this.isFileList(list)) return [list];
		return list.files;
	}
	
	getAllInFolder = async (folderId:string, pageToken:string = null):Promise<GoogleDriveFile[]> => {
		let list;   
		if (!folderId) list = pageToken != null ? await this._GETFiles('', `pageToken=${pageToken}`) : await this._GETFiles('', '')
		else list = pageToken != null ? await this._GETFiles('', `q='${folderId}' in parents&pageToken=${pageToken}`) : await this._GETFiles('', `q='${folderId}' in parents`);
		if (list.nextPageToken) list.files = list.files.concat(await this.getAllInFolder(folderId, list.nextPageToken));
		return list.files;
	}
	
	testFolder = async (folderId:string):Promise<boolean> => {
		try {
			const list = await this._GETFiles('', `q=\'${folderId}\'%20in%20parents`);
			if ((<GoogleDriveFileList>list).files) return true;
			return false;
		} catch (e) {
			console.error(e);
			return false;
		}
	}
	
	downloadArray = async (fileArray:GoogleDriveFile[], overwrite:boolean=false):Promise<void> => {
		let i = 0;
		console.log(`Downloading ${fileArray.length} files, this might take a while.`);
		const downloads = fs.readdirSync('./downloads');
		fileArray.forEach(async file => {
					if (file.name == '_DS_Store') return;
			if (!overwrite && downloads.indexOf(file.name) != -1) return console.log(`${file.name} has already been downloaded, not overwriting`);
			setTimeout(async () => {
				await this.downloadFile(file.id, file.name);
			}, 150 * i);
			i++;
		});
	}
	
	downloadFile = async (fileId:string, fileName:string, mimeType:string = 'application/vnd.google-apps.file') => {
		try {
            console.log(`Downloading ${fileName} (${fileId})`);
            let file = await (<GoogleDriveFile>await this._GETFiles('/'+fileId));
            if(this.mimeTypes[mimeType] != undefined) this._GETFilesStream(`/${fileId}/export`, `mimeType=${this.getExportMimeType(mimeType)}`, fs.createWriteStream(`./downloads/${fileName}${this.getExportExtension(mimeType)}`));
            else this._GETFilesStream('/'+fileId, 'alt=media', fs.createWriteStream(`./downloads/${fileName}`))//.then((data) => fs.writeFileSync(`./downloads/${fileName}`, data)).catch((err) => {throw err});
		} catch (e) {
			console.error(e);
			process.exit();
		}
    }
    
    refreshToken = async ():Promise<void> => {
        console.log('Refreshing Token...');
        let data = await snek.post(`https://www.googleapis.com/oauth2/v4/token?client_id=${this.client.client_id}&client_secret=${this.client.client_secret}&refresh_token=${this.refresh_token}&grant_type=refresh_token`);
        fs.writeFileSync('./token.json', data.body);
        setTimeout(this.refreshToken, (<TokenResponce>data.body).expires_in*1000);
        console.log('Token Refreshed!')
    }

    private waitForToken = (port:number = 8000):Promise<string> => new Promise((resolve, reject) => {
        console.log('creating server on port:' +port);
        const server = http.createServer((req, res) => {
            console.log('request recieved');
            res.end('<body>Test<script>window.close()</script></body>');
            server.close();
            resolve(req.url.split('?')[1].split('&').filter(e=>e.startsWith('code'))[0].split('=')[1]);
        }).listen(port);
        setTimeout(()=>{server.close(); reject('Server Timeout')}, 200000);
        
    })

    getCurrentDirectory = async ():Promise<GoogleDriveFile[]> => {
        return await this.getAllInFolder(this.curdir);
    }

    updateCurrentDirectory = (DirId:string):void => {
        this.curdir = DirId;
    }

    isFolder(file:GoogleDriveFile):boolean {
        return file.mimeType == 'application/vnd.google-apps.folder';
    }

    getExportMimeType = (mimeType:string):string => {
        return this.mimeTypes[mimeType];
    }

    getExportExtension = (mimeType:string):string => {
        return this.fileExtensions[mimeType];
    }

    private mimeTypes = {
        'application/vnd.google-apps.document':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.google-apps.spreadshet':'application/vnd.ms-excel',
        'application/vnd.google-apps.presentation':'application/vnd.ms-powerpoint',
        'application/vnd.google-apps.drawing':'image/png'
    };
    private fileExtensions = {
        'application/vnd.google-apps.document':'.docx',
        'application/vnd.google-apps.spreadshet':'.xls',
        'application/vnd.google-apps.presentation':'.ppt',
        'application/vnd.google-apps.drawing':'.png'
    };

    reLogon = async () => {
        await snek.get(`https://accounts.google.com/o/oauth2/revoke?token=${this.token}`);
        await this.getToken();
    }
	
}

export {
    GoogleDriveApi,
    GoogleDriveFile,
    GoogleDriveFileList
}



let token = {
    'token':'abcdefghijklmnopqrstuvwxyz'
}

console.log(token.token);
// >>> abcdefghijklmnopqrstuvwxyz

token.token = '1234567890';

console.log(token.token);
/// >> 1234567890