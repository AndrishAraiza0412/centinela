**Centinela**

Aplicación móvil desarrollada con React Native y Expo que permite consultar en tiempo real el estado operativo de diversos servicios de TI (como GitHub, AWS, Stripe) consumiendo una API pública. ¡Bienvenidos a su nueva aplicación Expo! Este proyecto utiliza enrutamiento basado en archivos (file-based routing), por lo que pueden comenzar a desarrollar editando los archivos directamente dentro del directorio `app`.

**Características**

* Búsqueda en tiempo real del estatus de servicios tecnológicos.
* Interfaz limpia con manejo de estados de carga y errores.
* Desarrollada con TypeScript para un tipado estricto y seguro.
* Arquitectura basada en Expo Router.

**Tecnologías Utilizadas**

* [React Native](https://reactnative.dev/)
* [Expo](https://expo.dev/) (SDK 57)
* [TypeScript](https://www.typescriptlang.org/)
* API Externa: [IsItDownStatus API](https://isitdownstatus.com/api/v1/status/)

**Estructura Principal**

El código principal de la interfaz y la lógica de peticiones se encuentra en:
`src/app/index.tsx`

**Requisitos Previos**

Antes de ejecutar el proyecto, asegúrate de tener instalado:
* [Node.js](https://nodejs.org/)
* Recomendado: La aplicación **Expo Go** instalada en tu dispositivo móvil (iOS / Android) o un emulador configurado (Android Studio / Xcode).

**Instalación y Ejecución**

1. Clonen el repositorio e ingresen a la carpeta:

```
git clone https://github.com/AndrishAraiza0412/centinela.git
cd ServiceStatusApp
```

2. Instalen las dependencias:

```
npm install
```

3. Inicien la aplicación:

```
npx expo start
```

En la salida de la terminal, encontrarán las opciones para abrir la aplicación en:

* Un build de desarrollo.
* Emulador de Android.
* Simulador de iOS.
* Expo Go (un entorno de pruebas limitado para experimentar con el desarrollo sin compilar nativamente).

**Equipo de Desarrollo**

* Araiza Espinoza Andrish Nayd
* Armenta Pacheco Sebastián 
* Morales Salazar Daniel Armando
* Murillo Monge Joshua David
* Perea Panduro Juan Carlos
