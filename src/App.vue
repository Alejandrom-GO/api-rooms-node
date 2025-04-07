<template>
  <div class="app-container">
    <h1>Prueba de Renderizado</h1>
    <p>Si puedes ver este mensaje, la aplicación está funcionando</p>
    <FileList />
  </div>
</template>

<script setup>
import FileList from './components/FileList.vue'
</script>

<style>
.app-container {
  padding: 20px;
  background-color: #f5f5f5;
  min-height: 100vh;
}

h1 {
  color: #333;
  text-align: center;
}

p {
  color: #666;
  text-align: center;
  margin-bottom: 20px;
}

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background-color: #f5f5f5;
}
</style>
