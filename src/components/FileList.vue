<template>
  <div class="file-manager">
    <h2>Administrador de Archivos</h2>
    
    <div v-if="!hasPermissions" class="permission-warning">
      <p>Se requieren permisos para acceder al sistema de archivos</p>
      <button @click="requestPermissions">Solicitar Permisos</button>
    </div>

    <div v-else>
      <div class="directory-selector">
        <select v-model="selectedDirectory">
          <option value="desktop">Escritorio</option>
          <option value="download">Descargas</option>
          <option value="document">Documentos</option>
        </select>
        <button @click="createDirectory">Crear Directorio</button>
      </div>

      <div class="operations">
        <div class="input-group">
          <input v-model="fileName" placeholder="Nombre del archivo" />
          <input v-model="fileContent" placeholder="Contenido del archivo" />
          <button @click="createFile">Crear Archivo</button>
        </div>

        <div v-if="error" class="error">
          {{ error }}
        </div>

        <div v-if="watching" class="file-watcher">
          <h3>Observando cambios en tiempo real</h3>
          <button @click="stopWatching">Detener observación</button>
        </div>

        <div class="files-list">
          <h3>Archivos en {{ selectedDirectory }}:</h3>
          <div v-if="currentPath" class="current-path">
            Ruta actual: {{ currentPath }}
          </div>
          <ul>
            <li v-for="entry in entries" :key="entry.path">
              <span :class="{ 'is-directory': entry.isDir }">
                {{ entry.name }}
              </span>
              <div class="actions">
                <button v-if="!entry.isDir" @click="readFile(entry.name)">Leer</button>
                <button v-if="entry.isDir" @click="navigateToDirectory(entry.name)">Abrir</button>
                <button @click="deleteEntry(entry)">Eliminar</button>
              </div>
            </li>
          </ul>
          <button v-if="directoryStack.length > 0" @click="navigateBack" class="back-button">
            Volver atrás
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { 
  readTextFile, 
  writeTextFile, 
  readDir,
  remove,
  mkdir,
  BaseDirectory,
  watchImmediate
} from '@tauri-apps/plugin-fs'
import { watch } from 'vue'

const fileName = ref('')
const fileContent = ref('')
const entries = ref([])
const error = ref('')
const selectedDirectory = ref('desktop')
const currentPath = ref('')
const directoryStack = ref([])
const watching = ref(false)
const hasPermissions = ref(false)
let unwatchFn = null

const baseDirectoryMap = {
  appData: BaseDirectory.AppData,
  appLocalData: BaseDirectory.AppLocalData,
  appConfig: BaseDirectory.AppConfig,
  desktop: BaseDirectory.Desktop,
  download: BaseDirectory.Download,
  document: BaseDirectory.Document
}

// Verificar permisos al montar el componente
onMounted(async () => {
  try {
    await checkPermissions()
    await listFiles()
  } catch (e) {
    error.value = `Error al inicializar: ${e}`
  }
})

// Verificar permisos
async function checkPermissions() {
  try {
    // Intentar acceder a un directorio para verificar permisos
    await readDir('', { dir: BaseDirectory.Download })
    hasPermissions.value = true
    error.value = ''
  } catch (e) {
    console.error('Error de permisos:', e)
    hasPermissions.value = false
    error.value = `Error de permisos: ${e}`
  }
}

// Solicitar permisos
async function requestPermissions() {
  try {
    // En Android, necesitamos solicitar permisos específicos
    if (window.Android) {
      // Intentar acceder a un directorio para forzar la solicitud de permisos
      await readDir('', { dir: BaseDirectory.Download })
      hasPermissions.value = true
    } else {
      // Para otras plataformas
      await checkPermissions()
    }
  } catch (e) {
    console.error('Error al solicitar permisos:', e)
    error.value = `Error al solicitar permisos: ${e}`
    hasPermissions.value = false
  }
}

// Navegar a un directorio
async function navigateToDirectory(dirName) {
  try {
    directoryStack.value.push(currentPath.value)
    const newPath = currentPath.value ? `${currentPath.value}/${dirName}` : dirName
    currentPath.value = newPath
    await listFiles()
  } catch (e) {
    error.value = `Error al navegar al directorio: ${e}`
  }
}

// Volver al directorio anterior
async function navigateBack() {
  if (directoryStack.value.length > 0) {
    currentPath.value = directoryStack.value.pop()
    await listFiles()
  }
}

// Crear directorio
async function createDirectory() {
  try {
    const dirName = prompt('Nombre del nuevo directorio:')
    if (!dirName) return

    const path = currentPath.value ? `${currentPath.value}/${dirName}` : dirName
    await mkdir(path, {
      baseDir: baseDirectoryMap[selectedDirectory.value],
      recursive: true
    })
    await listFiles()
  } catch (e) {
    error.value = `Error al crear directorio: ${e}`
  }
}

// Listar archivos
async function listFiles() {
  try {
    const path = currentPath.value || '.'
    const dirEntries = await readDir(path, {
      baseDir: baseDirectoryMap[selectedDirectory.value],
      recursive: false
    })
    entries.value = dirEntries
  } catch (e) {
    error.value = `Error al listar archivos: ${e}`
  }
}

// Crear archivo
async function createFile() {
  if (!fileName.value) {
    error.value = 'Por favor ingrese un nombre de archivo'
    return
  }

  try {
    const path = currentPath.value ? `${currentPath.value}/${fileName.value}` : fileName.value
    await writeTextFile(path, fileContent.value, {
      baseDir: baseDirectoryMap[selectedDirectory.value]
    })
    await listFiles()
    fileName.value = ''
    fileContent.value = ''
  } catch (e) {
    error.value = `Error al crear archivo: ${e}`
  }
}

// Leer archivo
async function readFile(name) {
  try {
    const path = currentPath.value ? `${currentPath.value}/${name}` : name
    const content = await readTextFile(path, {
      baseDir: baseDirectoryMap[selectedDirectory.value]
    })
    alert(`Contenido de ${name}:\n${content}`)
  } catch (e) {
    error.value = `Error al leer archivo: ${e}`
  }
}

// Eliminar archivo o directorio
async function deleteEntry(entry) {
  try {
    const path = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name
    await remove(path, {
      baseDir: baseDirectoryMap[selectedDirectory.value],
      recursive: entry.isDir
    })
    await listFiles()
  } catch (e) {
    error.value = `Error al eliminar: ${e}`
  }
}

// Observar cambios
async function startWatching() {
  try {
    const path = currentPath.value || '.'
    unwatchFn = await watchImmediate(
      path,
      (event) => {
        console.log('logs directory event', event);
        console.log('Cambio detectado:', event)
        listFiles()
      },
      {
        baseDir: baseDirectoryMap[selectedDirectory.value],
        recursive: true
      }
    )
    watching.value = true
  } catch (e) {
    error.value = `Error al iniciar la observación: ${e}`
  }
}

// Detener observación
async function stopWatching() {
  if (unwatchFn) {
    await unwatchFn()
    unwatchFn = null
    watching.value = false
  }
}

// Observar cambios en el directorio seleccionado
watch(selectedDirectory, async () => {
  currentPath.value = ''
  directoryStack.value = []
  await listFiles()
})
</script>

<style scoped>
.file-manager {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.permission-warning {
  text-align: center;
  padding: 20px;
  background-color: #fff3cd;
  border: 1px solid #ffeeba;
  border-radius: 4px;
  margin-bottom: 20px;
}

.directory-selector {
  margin-bottom: 20px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.operations {
  margin-top: 20px;
}

.input-group {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

input, select {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  width: 100%;
  max-width: 300px;
}

button {
  padding: 8px 16px;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

button:hover {
  background-color: #45a049;
}

.files-list {
  margin-top: 20px;
}

.current-path {
  margin: 10px 0;
  padding: 8px;
  background-color: #f5f5f5;
  border-radius: 4px;
  word-break: break-all;
}

.files-list ul {
  list-style: none;
  padding: 0;
}

.files-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid #eee;
  flex-wrap: wrap;
  gap: 8px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.is-directory {
  font-weight: bold;
  color: #2196F3;
}

.back-button {
  margin-top: 10px;
  background-color: #607D8B;
}

.error {
  color: #dc3545;
  padding: 10px;
  margin: 10px 0;
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
}

.file-watcher {
  margin-top: 20px;
  padding: 10px;
  background-color: #e8f5e9;
  border-radius: 4px;
}

/* Estilos responsive */
@media screen and (max-width: 768px) {
  .file-manager {
    padding: 10px;
  }

  .directory-selector {
    flex-direction: column;
  }

  .input-group {
    flex-direction: column;
  }

  input, select {
    max-width: 100%;
  }

  .files-list li {
    flex-direction: column;
    align-items: flex-start;
  }

  .actions {
    width: 100%;
    justify-content: flex-start;
  }

  button {
    width: 100%;
    margin-bottom: 5px;
  }
}

@media screen and (max-width: 480px) {
  h2 {
    font-size: 1.5rem;
  }

  h3 {
    font-size: 1.2rem;
  }

  .file-manager {
    padding: 5px;
  }
}
</style> 